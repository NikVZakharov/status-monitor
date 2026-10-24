import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configuration as configure,
  createMonitor as createProfileMonitor,
  run as runProfile,
} from "../src/monitor.mjs";
import { createStatusServer } from "../src/server.mjs";
import {
  initialState as initialStateCore,
  observe as observeCore,
  publicStatus as publicStatusCore,
  saveState as saveStateCore,
  validateState as validateStateCore,
} from "../src/status-state.mjs";


import profile from "./fixtures/profile.mjs";
const initialState = () => initialStateCore(profile);
const observe = (state, observation, now) => observeCore(state, observation, now, profile);
const publicStatus = (state, now, validForMs) => publicStatusCore(state, now, validForMs, profile);
const saveState = (path, state) => saveStateCore(path, state, profile);
const validateState = (state) => validateStateCore(state, profile);
const configuration = (env) => configure(env, profile);
const withProfile = config => ({...config, profile, targets: config.targets ?? {api:config.apiUrl,web:config.webUrl}});
const createMonitor = (config, options) => createProfileMonitor(withProfile(config), options);
const run = (config) => runProfile(withProfile(config));

const html =
  '<!doctype html><html><head><script type="module" src="/assets/status-abc.js"></script></head><body><div id="root"></div></body></html>';
const healthy = {
  api: "operational",
  web: "operational",
  access: "operational",
};
const failed = { api: "outage", web: "outage", access: "outage" };
const initialTime = Date.parse("2026-10-07T10:00:00.000Z");

async function listen(server, t) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), "example-status-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundleDirectory = join(directory, "public");
  const stateDirectory = join(directory, "state");
  await mkdir(bundleDirectory);
  await mkdir(stateDirectory);
  await mkdir(join(bundleDirectory, "assets"));
  await writeFile(join(bundleDirectory, "index.html"), html);
  await writeFile(
    join(bundleDirectory, "assets", "status-abc.js"),
    "export {};\n",
  );
  const calls = [];
  const behavior = {
    apiStatus: 200,
    supabaseConnected: true,
    service: "example-api",
    webStatus: 200,
    webBody: html,
    apiDelay: 0,
    extra: {},
    apiBody: null,
    apiLocation: null,
    webLocation: null,
  };
  const source = createServer(async (request, response) => {
    calls.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
    });
    if (request.url === "/ready") {
      if (behavior.apiDelay)
        await new Promise((resolve) => setTimeout(resolve, behavior.apiDelay));
      response.writeHead(behavior.apiStatus, {
        "content-type": "application/json",
        ...(behavior.apiLocation ? { location: behavior.apiLocation } : {}),
      });
      response.end(
        behavior.apiBody ??
          JSON.stringify({
            service: behavior.service,
            supabaseConnected: behavior.supabaseConnected,
            ...behavior.extra,
          }),
      );
    } else if (request.url === "/sign-in") {
      response.writeHead(behavior.webStatus, {
        "content-type": "text/html",
        ...(behavior.webLocation ? { location: behavior.webLocation } : {}),
      });
      response.end(behavior.webBody);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  const url = await listen(source, t);
  let now = initialTime;
  const config = {
    stateDirectory,
    bundleDirectory,
    apiUrl: `${url}/ready`,
    webUrl: `${url}/sign-in`,
    timeoutMs: 100,
    intervalMs: 5000,
    validForMs: 1000,
    host: "127.0.0.1",
    port: 0,
  };
  return {
    directory,
    behavior,
    calls,
    config,
    clock: () => now,
    tick: (milliseconds = 100) => {
      now += milliseconds;
    },
    now: () => now,
  };
}

test("actual public probes prepare operational status without leaking responses or credentials", async (t) => {
  const h = await harness(t);
  h.behavior.extra = {
    token: "SECRET_TOKEN",
    digest: "sha256:internal",
    version: "9.9.9",
    error: "postgres://private-host",
  };
  const monitor = await createMonitor(h.config, { clock: h.clock });
  assert.equal(monitor.status().overall.status, "unknown");
  const feed = await monitor.observe();
  assert.equal(feed.overall.status, "operational");
  assert.equal(feed.observationState, "current");
  assert.deepEqual(feed.lastKnownComponents, []);
  assert.deepEqual(
    feed.components.map(({ id, status }) => ({ id, status })),
    Object.keys(healthy).map((id) => ({ id, status: "operational" })),
  );
  assert.equal(feed.activeIncidents.length, 0);
  assert.equal(feed.history.length, 0);
  assert.equal(feed.observedAt, new Date(h.now()).toISOString());
  assert.equal(feed.validUntil, new Date(h.now() + 1000).toISOString());
  assert.doesNotMatch(
    JSON.stringify(feed),
    /SECRET|sha256|9\.9\.9|postgres|127\.0\.0\.1|supabaseConnected|componentId/,
  );
  assert.deepEqual(
    h.calls
      .map(({ method, url }) => ({ method, url }))
      .sort((a, b) => a.url.localeCompare(b.url)),
    [
      { method: "GET", url: "/ready" },
      { method: "GET", url: "/sign-in" },
    ],
  );
  for (const call of h.calls) {
    assert.equal(call.headers.authorization, undefined);
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers.apikey, undefined);
  }
  assert.equal(
    (await stat(join(h.config.stateDirectory, "observations.json"))).mode &
      0o777,
    0o600,
  );
});

test("two failures open real incidents; restart preserves them; two successes resolve with dated history", async (t) => {
  const h = await harness(t);
  let monitor = await createMonitor(h.config, { clock: h.clock });
  await monitor.observe();
  h.behavior.apiStatus = 503;
  h.behavior.supabaseConnected = false;
  h.behavior.webStatus = 503;
  h.tick();
  const first = await monitor.observe();
  assert.equal(first.overall.status, "degraded");
  assert.equal(first.activeIncidents.length, 0);
  h.tick();
  const second = await monitor.observe();
  assert.equal(second.overall.status, "outage");
  assert.equal(second.activeIncidents.length, 3);
  assert(
    second.activeIncidents.every(
      ({ status, resolvedAt }) =>
        status === "investigating" && resolvedAt === null,
    ),
  );
  const incidentIds = second.activeIncidents.map(({ id }) => id);
  monitor = await createMonitor(h.config, { clock: h.clock });
  assert.deepEqual(
    monitor.status().activeIncidents.map(({ id }) => id),
    incidentIds,
  );
  h.behavior.apiStatus = 200;
  h.behavior.supabaseConnected = true;
  h.behavior.webStatus = 200;
  h.tick();
  const recovery = await monitor.observe();
  assert.equal(recovery.overall.status, "outage");
  assert(
    recovery.activeIncidents.every(({ status }) => status === "monitoring"),
  );
  h.tick();
  const resolved = await monitor.observe();
  assert.equal(resolved.overall.status, "operational");
  assert.equal(resolved.activeIncidents.length, 0);
  assert.equal(resolved.history.length, 3);
  assert(
    resolved.history.every(
      ({ status, startedAt, resolvedAt, updates }) =>
        status === "resolved" &&
        Date.parse(resolvedAt) > Date.parse(startedAt) &&
        updates.length === 3,
    ),
  );
  monitor = await createMonitor(h.config, { clock: h.clock });
  assert.deepEqual(monitor.status().history, resolved.history);
});

test("missing and expired observations are unknown on every GET while actual history remains", async (t) => {
  const h = await harness(t);
  const monitor = await createMonitor(h.config, { clock: h.clock });
  const server = await createStatusServer(
    h.config.bundleDirectory,
    monitor.status,
  );
  const url = await listen(server, t);
  const initial = await (await fetch(`${url}/status.json`)).json();
  assert.equal(initial.observedAt, null);
  assert.equal(initial.validUntil, null);
  assert.equal(initial.overall.status, "unknown");
  assert.equal(initial.observationState, "unobserved");
  assert.equal(initial.overall.title, "Наблюдений пока нет");
  assert.deepEqual(initial.components, []);
  assert.deepEqual(initial.lastKnownComponents, []);
  await monitor.observe();
  const current = await (await fetch(`${url}/status.json`)).json();
  assert.equal(current.overall.status, "operational");
  assert.equal(current.observationState, "current");
  assert.deepEqual(current.lastKnownComponents, []);
  h.tick(1000);
  const expired = await (await fetch(`${url}/status.json`)).json();
  assert.equal(expired.overall.status, "unknown");
  assert.equal(expired.observationState, "stale");
  assert.equal(expired.overall.title, "Данные о состоянии устарели");
  assert(expired.components.every(({ status }) => status === "unknown"));
  assert.deepEqual(
    expired.lastKnownComponents.map(({ id, name, status }) => ({
      id,
      name,
      status,
    })),
    current.components.map(({ id, name, status }) => ({ id, name, status })),
  );
  assert(
    expired.lastKnownComponents.every(
      ({ label }) => label === "Последняя проверка прошла успешно",
    ),
  );
  assert.notEqual(expired.observedAt, null);
  h.tick(100);
  assert.equal(
    (await (await fetch(`${url}/status.json`)).json()).overall.status,
    "unknown",
  );
});

test("wrong service, malformed/oversized JSON and non-application HTML cannot claim health", async (t) => {
  const h = await harness(t);
  const monitor = await createMonitor(h.config, { clock: h.clock });
  h.behavior.service = "other-api";
  h.behavior.webBody = "<html><body>proxy works</body></html>";
  let feed = await monitor.observe();
  assert.equal(
    feed.components.find(({ id }) => id === "access").status,
    "unknown",
  );
  assert.equal(feed.overall.status, "degraded");
  h.behavior.apiBody = "invalid {json";
  h.tick();
  feed = await monitor.observe();
  assert.equal(feed.overall.status, "outage");
  assert.equal(feed.activeIncidents.length, 2);
  h.behavior.apiBody = JSON.stringify({
    service: "example-api",
    supabaseConnected: true,
    noise: "x".repeat(40_000),
  });
  h.tick();
  feed = await monitor.observe();
  assert.equal(feed.overall.status, "outage");
  assert.equal(
    feed.components.find(({ id }) => id === "access").status,
    "unknown",
  );
  assert.doesNotMatch(JSON.stringify(feed), /invalid|noise|proxy works/);
});

test("actual HTTP timeout is bounded and unavailable API leaves data access unknown", async (t) => {
  const h = await harness(t);
  h.behavior.apiDelay = 300;
  const monitor = await createMonitor(h.config, { clock: h.clock });
  const started = Date.now();
  const feed = await monitor.observe();
  assert(Date.now() - started < 1000);
  assert.equal(
    feed.components.find(({ id }) => id === "web").status,
    "operational",
  );
  assert.equal(
    feed.components.find(({ id }) => id === "access").status,
    "unknown",
  );
  assert.equal(feed.overall.status, "degraded");
  assert(h.calls.every(({ method }) => method === "GET"));
});

test("independent HTTP server exposes read-only JSON and static bundle with safe cache/path policy", async (t) => {
  const h = await harness(t);
  const secretFile = join(h.directory, "secret.html");
  await writeFile(secretFile, "secret outside bundle");
  await symlink(secretFile, join(h.config.bundleDirectory, "outside.html"));
  await writeFile(
    join(h.config.bundleDirectory, "config.json"),
    '{"secret":"never serve"}',
  );
  const monitor = await createMonitor(h.config, { clock: h.clock });
  const server = await createStatusServer(
    h.config.bundleDirectory,
    monitor.status,
  );
  const url = await listen(server, t);
  const root = await fetch(url);
  assert.equal(root.status, 200);
  assert.equal(await root.text(), html);
  assert.equal(root.headers.get("cache-control"), "no-cache");
  assert.match(
    root.headers.get("content-security-policy"),
    /connect-src 'self'/,
  );
  const json = await fetch(`${url}/status.json`);
  assert.equal(json.status, 200);
  assert.equal(json.headers.get("cache-control"), "no-store");
  assert.equal((await json.json()).overall.status, "unknown");
  const head = await fetch(`${url}/status.json`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const asset = await fetch(`${url}/assets/status-abc.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control"), /immutable/);
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const refused = await fetch(`${url}/status.json`, { method });
    assert.equal(refused.status, 405);
    assert.equal(refused.headers.get("allow"), "GET, HEAD");
  }
  for (const path of [
    "/outside.html",
    "/config.json",
    "/.env",
    "/missing.js",
    "/%2e%2e/secret.html",
    "/%2e%2e%2fsecret.html",
  ]) {
    const refused = await fetch(`${url}${path}`);
    assert.equal(refused.status, 404);
    assert.equal(await refused.text(), "");
  }
});

test("malformed persisted state is rejected without resetting incidents or fabricating green", async (t) => {
  const h = await harness(t);
  const statePath = join(h.config.stateDirectory, "observations.json");
  await writeFile(statePath, '{"token":"SECRET","observedAt":null}');
  await assert.rejects(
    createMonitor(h.config),
    /Cannot load valid persisted status state/,
  );
  assert.equal(
    await readFile(statePath, "utf8"),
    '{"token":"SECRET","observedAt":null}',
  );
  const fabricated = initialState();
  fabricated.components[0].status = "operational";
  assert.throws(() => validateState(fabricated), /Unobserved persisted state/);
  const polluted = observe(initialState(), failed, initialTime);
  polluted.hiddenInternalUrl = "http://private-host";
  assert.throws(
    () => validateState(polluted),
    /Invalid persisted status state/,
  );
});

test("overlapping iterations share one probe and failure to persist cannot publish new green", async (t) => {
  const h = await harness(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requests = 0;
  let saves = 0;
  const fetcher = async (url, options) => {
    requests += 1;
    await gate;
    return fetch(url, options);
  };
  const monitor = await createMonitor(h.config, {
    clock: h.clock,
    fetcher,
    persist: async () => {
      saves += 1;
      throw new Error("disk failure SECRET");
    },
  });
  const one = monitor.observe();
  const two = monitor.observe();
  assert.equal(one, two);
  release();
  await assert.rejects(one, /disk failure/);
  assert.equal(requests, 2);
  assert.equal(saves, 1);
  assert.equal(monitor.status().overall.status, "unknown");
  assert.equal(monitor.status().observedAt, null);
  assert.doesNotMatch(JSON.stringify(monitor.status()), /disk failure|SECRET/);
});

test("history and incident updates remain finite and dated history expires without invented uptime", () => {
  let state = initialState();
  let now = initialTime;
  for (let index = 0; index < 20; index += 1) {
    state = observe(state, failed, (now += 100));
    state = observe(state, failed, (now += 100));
    state = observe(state, healthy, (now += 100));
    state = observe(state, healthy, (now += 100));
  }
  assert.equal(state.history.length, 50);
  let feed = publicStatus(state, now, 1000);
  assert.equal(feed.history.length, 50);
  assert.doesNotMatch(JSON.stringify(feed), /uptime|100%|percentage/);
  feed = publicStatus(state, now + 31 * 86_400_000, 1000);
  assert.equal(feed.overall.status, "unknown");
  assert.equal(feed.history.length, 0);
  state = observe(initialState(), failed, initialTime);
  state = observe(state, failed, initialTime + 1);
  for (let index = 0; index < 30; index += 1) {
    state = observe(state, healthy, initialTime + 2 + index * 2);
    state = observe(state, failed, initialTime + 3 + index * 2);
  }
  assert(state.activeIncidents.every(({ updates }) => updates.length === 20));
});

test("configuration requires explicit endpoints and timings, refuses secret URLs and exposed bind", () => {
  const environment = {
    STATUS_STATE_DIRECTORY: "/var/lib/status",
    STATUS_BUNDLE_DIRECTORY: "/opt/status/public",
    STATUS_HOST: "127.0.0.1",
    STATUS_PORT: "3020",
    STATUS_INTERVAL_MS: "30000",
    STATUS_TIMEOUT_MS: "5000",
    STATUS_VALID_FOR_MS: "120000",
    STATUS_API_URL: "https://api.example.test/ready",
    STATUS_WEB_URL: "https://example.test/sign-in",
  };
  const config = configuration(environment);
  assert.equal(config.targets.api, environment.STATUS_API_URL);
  assert.throws(() => configuration({}), /Absolute state/);
  for (const STATUS_API_URL of [
    "https://user:SECRET@example.test/ready",
    "https://example.test/ready?token=SECRET",
    "https://example.test/ready#secret",
    "http://private.example/ready",
  ])
    assert.throws(
      () => configuration({ ...environment, STATUS_API_URL }),
      /Invalid public probe/,
    );
  assert.throws(
    () => configuration({ ...environment, STATUS_HOST: "0.0.0.0" }),
    /loopback/,
  );
  assert.throws(
    () => configuration({ ...environment, STATUS_INTERVAL_MS: "NaN" }),
    /invalid STATUS_INTERVAL_MS/,
  );
  assert.throws(
    () => configuration({ ...environment, STATUS_VALID_FOR_MS: "30001" }),
    /Out of bounds/,
  );
  assert.throws(
    () => configuration({ ...environment, STATUS_ACCESS_CLIENT_ID: "only-id" }),
    /complete pair/,
  );
  assert.throws(
    () =>
      configuration({
        ...environment,
        STATUS_ACCESS_CLIENT_ID: "id",
        STATUS_ACCESS_CLIENT_SECRET: "bad\r\nheader",
      }),
    /complete pair/,
  );
});

test("Cloudflare Access gates mean unknown, with no fabricated outage or followed authorization redirect", async (t) => {
  const h = await harness(t);
  const monitor = await createMonitor(h.config, { clock: h.clock });
  h.behavior.apiStatus = 302;
  h.behavior.webStatus = 302;
  h.behavior.apiLocation =
    "https://example.cloudflareaccess.com/cdn-cgi/access/login/example.app?token=SECRET_REDIRECT";
  h.behavior.webLocation = h.behavior.apiLocation;
  let feed = await monitor.observe();
  h.tick();
  feed = await monitor.observe();
  assert.equal(feed.overall.status, "unknown");
  assert(feed.components.every(({ status }) => status === "unknown"));
  assert.equal(feed.activeIncidents.length, 0);
  assert.equal(h.calls.length, 4);
  assert.doesNotMatch(
    JSON.stringify(feed),
    /SECRET|cloudflareaccess|token|redirect/,
  );
  h.behavior.apiStatus = 401;
  h.behavior.webStatus = 403;
  h.behavior.apiBody = "login refusal SECRET_RESPONSE".repeat(5000);
  h.tick();
  feed = await monitor.observe();
  assert.equal(feed.overall.status, "unknown");
  assert.equal(feed.activeIncidents.length, 0);
  h.behavior.apiStatus = 302;
  h.behavior.webStatus = 302;
  h.behavior.apiBody = null;
  h.behavior.apiLocation = `${h.config.apiUrl}/untrusted-redirect`;
  h.behavior.webLocation = `${h.config.webUrl}/untrusted-redirect`;
  h.tick();
  feed = await monitor.observe();
  assert.equal(feed.overall.status, "degraded");
  assert(h.calls.every(({ url }) => ["/ready", "/sign-in"].includes(url)));
});

test("optional Access service token goes only to explicit probe targets and never enters public state", async (t) => {
  const h = await harness(t);
  h.config.accessCredentials = {
    clientId: "PRIVATE_CLIENT_ID",
    clientSecret: "PRIVATE_CLIENT_SECRET",
  };
  const monitor = await createMonitor(h.config, { clock: h.clock });
  const feed = await monitor.observe();
  assert.equal(feed.overall.status, "operational");
  for (const call of h.calls) {
    assert(["/ready", "/sign-in"].includes(call.url));
    assert.equal(call.headers["cf-access-client-id"], "PRIVATE_CLIENT_ID");
    assert.equal(
      call.headers["cf-access-client-secret"],
      "PRIVATE_CLIENT_SECRET",
    );
  }
  assert.doesNotMatch(JSON.stringify(feed), /PRIVATE_CLIENT|cf-access/);
  assert.doesNotMatch(
    await readFile(join(h.config.stateDirectory, "observations.json"), "utf8"),
    /PRIVATE_CLIENT|cf-access/,
  );
});

test("shutdown permits a persisted restart through the canonical service runtime", async (t) => {
  const h = await harness(t);
  const instance = await run(h.config);
  t.after(() => instance.stop());
  const port = instance.server.address().port;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const feed = await (
    await fetch(`http://127.0.0.1:${port}/status.json`)
  ).json();
  assert.equal(feed.overall.status, "operational");
  await instance.stop();
  const restarted = await run(h.config);
  t.after(() => restarted.stop());
  const persisted = JSON.parse(
    await readFile(join(h.config.stateDirectory, "observations.json"), "utf8"),
  );
  assert.notEqual(persisted.observedAt, null);
  await restarted.stop();
});

test("a future observation after clock rollback is unknown, never fresh green", () => {
  const state = observe(initialState(), healthy, initialTime + 10_000);
  const feed = publicStatus(state, initialTime, 120_000);
  assert.equal(feed.overall.status, "unknown");
  assert.equal(feed.observationState, "unconfirmed");
  assert.deepEqual(feed.lastKnownComponents, []);
  assert(feed.components.every(({ status }) => status === "unknown"));
  assert.equal(feed.observedAt, new Date(initialTime + 10_000).toISOString());
  assert.throws(
    () => observe(state, healthy, initialTime),
    /clock moved backwards/,
  );
});

test("public incident updates arrive newest first without mutating persisted chronology", () => {
  let state = observe(initialState(), failed, initialTime);
  state = observe(state, failed, initialTime + 100);
  state = observe(state, healthy, initialTime + 200);
  const persistedActive = JSON.stringify(state);
  const active = publicStatus(state, initialTime + 200, 1000);
  assert(
    active.activeIncidents.every(
      ({ updates }) =>
        updates[0].at === new Date(initialTime + 200).toISOString() &&
        updates[1].at === new Date(initialTime + 100).toISOString(),
    ),
  );
  assert.equal(JSON.stringify(state), persistedActive);
  active.activeIncidents[0].updates[0].message = "public copy";
  assert.equal(JSON.stringify(state), persistedActive);
  state = observe(state, healthy, initialTime + 300);
  const persistedResolved = JSON.stringify(state);
  const resolved = publicStatus(state, initialTime + 300, 1000);
  assert(
    resolved.history.every(
      ({ updates }) =>
        updates.map(({ at }) => at).join() ===
        [300, 200, 100]
          .map((offset) => new Date(initialTime + offset).toISOString())
          .join(),
    ),
  );
  assert.equal(JSON.stringify(state), persistedResolved);
  assert(
    state.history.every(
      ({ updates }) =>
        updates.map(({ at }) => at).join() ===
        [100, 200, 300]
          .map((offset) => new Date(initialTime + offset).toISOString())
          .join(),
    ),
  );
  assert.deepEqual(Object.keys(state).sort(), [
    "activeIncidents",
    "components",
    "history",
    "observedAt",
  ]);
});

test("stale presentation retains only actual historical outage and unknown component signals", () => {
  const observation = { api: "outage", web: "operational", access: "unknown" };
  let state = observe(initialState(), observation, initialTime);
  state = observe(state, observation, initialTime + 100);
  const persisted = JSON.stringify(state);
  const feed = publicStatus(state, initialTime + 1100, 1000);
  assert.equal(feed.observationState, "stale");
  assert.equal(feed.overall.status, "unknown");
  assert.deepEqual(
    feed.components.map(({ status }) => status),
    ["unknown", "unknown", "unknown"],
  );
  assert.deepEqual(
    feed.lastKnownComponents.map(({ status }) => status),
    ["outage", "operational", "unknown"],
  );
  assert.deepEqual(
    feed.lastKnownComponents.map(({ label }) => label),
    [
      "Недоступно при последней проверке",
      "Последняя проверка прошла успешно",
      "Нет данных последней проверки",
    ],
  );
  assert(
    feed.lastKnownComponents.every(
      (entry) => Object.keys(entry).sort().join() === "id,label,name,status",
    ),
  );
  assert.equal(JSON.stringify(state), persisted);
});

test("failed atomic replacement preserves existing state and removes its temporary file", async (t) => {
  const h = await harness(t);
  const blockedPath = join(h.config.stateDirectory, "observations.json");
  await mkdir(blockedPath);
  await writeFile(join(blockedPath, "sentinel"), "preserve");
  await assert.rejects(saveState(blockedPath, initialState()));
  assert.deepEqual(await readdir(h.config.stateDirectory), [
    "observations.json",
  ]);
  assert.equal(
    await readFile(join(blockedPath, "sentinel"), "utf8"),
    "preserve",
  );
});

const hasKernelFlock =
  process.platform === "linux" &&
  spawnSync("flock", ["--help"], { encoding: "utf8" }).stdout?.includes(
    "--no-fork",
  );
test(
  "kernel lock rejects a live second process and releases after SIGKILL preserving observations",
  {
    skip: hasKernelFlock
      ? false
      : "Requires Linux util-linux flock; run this proof in the isolated Linux container",
  },
  async (t) => {
    const h = await harness(t);
    h.behavior.apiStatus = 503;
    h.behavior.supabaseConnected = false;
    h.behavior.webStatus = 503;
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const environment = {
      ...process.env,
        STATUS_PROFILE_PATH: new URL("./fixtures/profile.mjs", import.meta.url).pathname,
      STATUS_MONITOR_LOCKED: "",
      STATUS_HOST: "127.0.0.1",
      STATUS_PORT: String(port),
      STATUS_STATE_DIRECTORY: h.config.stateDirectory,
      STATUS_BUNDLE_DIRECTORY: h.config.bundleDirectory,
      STATUS_INTERVAL_MS: "5000",
      STATUS_TIMEOUT_MS: "100",
      STATUS_VALID_FOR_MS: "20000",
      STATUS_API_URL: h.config.apiUrl,
      STATUS_WEB_URL: h.config.webUrl,
    };
    const launch = () => {
      const child = spawn(
        "bash",
        [new URL("../run.sh", import.meta.url).pathname],
        { env: environment, stdio: "ignore" },
      );
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "exit");
        }
      });
      return child;
    };
    const waitFor = async (status) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          const feed = await (
            await fetch(`http://127.0.0.1:${port}/status.json`, {
              signal: AbortSignal.timeout(500),
            })
          ).json();
          if (feed.overall.status === status) return feed;
        } catch {
          /* The independently owned process may still be starting. */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Status process did not reach ${status}`);
    };
    const first = launch();
    const initial = await waitFor("degraded");
    assert.equal(initial.activeIncidents.length, 0);
    const second = launch();
    const [code] = await once(second, "exit", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(code, 73);
    const killed = once(first, "exit");
    first.kill("SIGKILL");
    await killed;
    assert.equal(
      JSON.parse(
        await readFile(
          join(h.config.stateDirectory, "observations.json"),
          "utf8",
        ),
      ).components[0].failures,
      1,
    );
    const restarted = launch();
    const confirmed = await waitFor("outage");
    assert.equal(confirmed.activeIncidents.length, 3);
    assert.equal(
      JSON.parse(
        await readFile(
          join(h.config.stateDirectory, "observations.json"),
          "utf8",
        ),
      ).components[0].failures,
      2,
    );
    const stopped = once(restarted, "exit");
    restarted.kill("SIGTERM");
    await stopped;
  },
);
