import assert from "node:assert/strict";
import { createSecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { requestProbe } from "../src/probe-transport.mjs";

// The canonical test launcher generates process-scoped throwaway credentials.
// Production uses Node's standard certificate and hostname validation.
const directory = process.env.STATUS_TEST_TLS_DIRECTORY;
if (!directory) throw new Error("Use node tests/run-status-transport.mjs");
const certificatePath = `${directory}/localhost-cert.pem`;
const keyPath = `${directory}/localhost-key.pem`;
async function harness(t, handler) {
  const server = createSecureServer({
    cert: await readFile(certificatePath),
    key: await readFile(keyPath),
  });
  const sessions = new Set();
  const seen = [];
  server.on("session", (session) => {
    sessions.add(session);
    session.on("error", () => {});
    session.on("close", () => sessions.delete(session));
  });
  server.on("stream", (stream, headers) => {
    stream.on("error", () => {});
    seen.push(headers);
    handler(stream, headers);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    for (const session of sessions) session.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `https://localhost:${server.address().port}`, sessions, seen };
}
function request(url, options = {}) {
  return requestProbe(
    url,
    {
      accept: "application/json",
      "cf-access-client-id": "TEST_ID",
      "cf-access-client-secret": "TEST_SECRET",
    },
    {
      maximumBytes: 1024,
      timeoutMs: 1000,
      discardBody: (response) => response.status === 302,
      ...options,
    },
  );
}
async function sessionsClosed(h) {
  for (let attempt = 0; attempt < 50 && h.sessions.size; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    h.sessions.size,
    0,
    "transport must close its session after every outcome",
  );
}
test("HTTPS HTTP/2 validates TLS and sends only one GET to the explicit path", async (t) => {
  const h = await harness(t, (stream) => {
    stream.respond({ ":status": 200, "content-type": "application/json" });
    stream.end('{"ok":true}');
  });
  const result = await request(`${h.url}/ready`);
  assert.equal(result.response.status, 200);
  assert.equal(result.text, '{"ok":true}');
  assert.equal(h.seen.length, 1);
  assert.equal(h.seen[0][":method"], "GET");
  assert.equal(h.seen[0][":path"], "/ready");
  assert.equal(h.seen[0]["cf-access-client-id"], "TEST_ID");
  assert.equal(h.seen[0]["cf-access-client-secret"], "TEST_SECRET");
  assert.equal(h.seen[0].cookie, undefined);
  assert.equal(h.seen[0].authorization, undefined);
  await sessionsClosed(h);
});
test("HTTPS authorization redirect is cancelled without following or transferring credentials", async (t) => {
  const h = await harness(t, (stream) => {
    stream.respond({ ":status": 302, location: "/destination" });
    stream.write("access login");
  });
  const result = await request(`${h.url}/ready`);
  assert.equal(result.blockedByAuthorization, true);
  assert.equal(result.text, "");
  assert.equal(h.seen.length, 1);
  await sessionsClosed(h);
});
test("HTTPS body limit closes the stream and session", async (t) => {
  const h = await harness(t, (stream) => {
    stream.respond({ ":status": 200 });
    stream.end("X".repeat(1025));
  });
  await assert.rejects(request(`${h.url}/ready`), /exceeds bound/);
  await sessionsClosed(h);
});
test("HTTPS deadline covers a body that stalls after headers", async (t) => {
  const h = await harness(t, (stream) => {
    stream.respond({ ":status": 200 });
    stream.write("partial");
  });
  const started = Date.now();
  await assert.rejects(
    request(`${h.url}/ready`, { timeoutMs: 100 }),
    /deadline exceeded/,
  );
  assert(Date.now() - started < 1000);
  await sessionsClosed(h);
});
test("HTTPS premature body abort cannot publish a successful partial response", async (t) => {
  const h = await harness(t, (stream) => {
    stream.respond({ ":status": 200 });
    stream.write("partial");
    setTimeout(() => stream.session?.destroy(), 10);
  });
  await assert.rejects(
    request(`${h.url}/ready`),
    /aborted|closed|cancel|reset/i,
  );
  await sessionsClosed(h);
});
test("HTTPS wrong certificate hostname is rejected without any authenticated request", async (t) => {
  const h = await harness(t, (stream) => {
    stream.respond({ ":status": 200 });
    stream.end();
  });
  await assert.rejects(
    request(`${h.url.replace("localhost", "127.0.0.1")}/ready`),
    (error) =>
      error.code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
      error.cause?.code === "ERR_TLS_CERT_ALTNAME_INVALID",
  );
  assert.equal(h.seen.length, 0);
  await sessionsClosed(h);
});

test("HTTPS untrusted certificate is rejected before Access credentials are sent", async (t) => {
  const h = await harness(t, (stream) => {
    stream.respond({ ":status": 200 });
    stream.end();
  });
  const { spawn } = await import("node:child_process");
  const transportUrl = new URL(
    "../src/probe-transport.mjs",
    import.meta.url,
  ).href;
  const source = `import { requestProbe } from ${JSON.stringify(transportUrl)};
    try { await requestProbe(${JSON.stringify(`${h.url}/ready`)}, {"cf-access-client-secret":"TEST_SECRET"}, {maximumBytes:1024, timeoutMs:1000, discardBody:()=>false}); process.exitCode=1; }
    catch (error) { const code=error.cause?.code??error.code; process.stdout.write(code); if(code!=="DEPTH_ZERO_SELF_SIGNED_CERT")process.exitCode=2; }`;
  const environment = { ...process.env };
  delete environment.NODE_EXTRA_CA_CERTS;
  delete environment.NODE_TLS_REJECT_UNAUTHORIZED;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.resume();
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0);
  assert.equal(output, "DEPTH_ZERO_SELF_SIGNED_CERT");
  assert.equal(h.seen.length, 0);
  await sessionsClosed(h);
});

test("HTTPS deadline includes a peer that never completes TLS", async (t) => {
  const { createServer } = await import("node:net");
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.on("data", () => {});
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const started = Date.now();
  await assert.rejects(
    request(`https://localhost:${server.address().port}/ready`, {
      timeoutMs: 100,
    }),
    /deadline exceeded/,
  );
  assert(Date.now() - started < 1000);
  for (let attempt = 0; attempt < 50 && sockets.size; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sockets.size, 0);
});

test("Explicit HTTPS/1.1 Quarkus transport validates TLS, preserves bounds and never follows redirects", async t => {
  const seen=[];
  const server=createHttpsServer({cert:await readFile(certificatePath),key:await readFile(keyPath)},(req,res)=>{
    seen.push(req.url);
    if(req.url==='/redirect'){res.writeHead(302,{location:'/ready'});res.end();}
    else if(req.url==='/large'){res.writeHead(200);res.end('x'.repeat(2048));}
    else if(req.url==='/stall'){res.writeHead(200);res.write(' ');}
    else {res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`https://localhost:${server.address().port}`;
  assert.equal((await request(url+'/ready',{httpsProtocol:'http/1.1'})).text,'{"ok":true}');
  assert.equal((await request(url+'/redirect',{httpsProtocol:'http/1.1'})).blockedByAuthorization,true);
  assert.deepEqual(seen,['/ready','/redirect']);
  await assert.rejects(request(url+'/large',{httpsProtocol:'http/1.1'}),/exceeds bound/);
  await assert.rejects(request(url+'/stall',{httpsProtocol:'http/1.1',timeoutMs:100}),/deadline/);
  const requests=seen.length;
  await assert.rejects(request(url.replace('localhost','127.0.0.1')+'/ready',{httpsProtocol:'http/1.1'}),/IP|certificate|altname/i);
  assert.equal(seen.length,requests);
});
