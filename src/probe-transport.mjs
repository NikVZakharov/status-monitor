import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect, sensitiveHeaders } from "node:http2";

/** One read-only request to the configured target; redirects are never followed. */
export function requestProbe(
  url,
  headers,
  { maximumBytes, timeoutMs, discardBody, httpsProtocol = "h2" },
) {
  const target = new URL(url);
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(
    target.hostname,
  );
  if (
    !["h2", "http/1.1"].includes(httpsProtocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" && !(target.protocol === "http:" && loopback))
  )
    throw new Error("Invalid probe target");
  return new Promise((resolve, reject) => {
    let session;
    let stream;
    let responseBody;
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error("Probe deadline exceeded")),
      timeoutMs,
    );
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      responseBody?.destroy();
      stream?.destroy();
      session?.destroy();
      if (error) reject(error);
      else resolve(value);
    }
    function collect(status, rawHeaders, body) {
      responseBody = body;
      const response = { status, headers: new Headers() };
      for (const [name, value] of Object.entries(rawHeaders)) {
        if (name.startsWith(":")) continue;
        if (Array.isArray(value))
          for (const item of value) response.headers.append(name, item);
        else if (value !== undefined) response.headers.set(name, String(value));
      }
      if (discardBody(response)) {
        finish(null, { response, text: "", blockedByAuthorization: true });
        return;
      }
      const chunks = [];
      let size = 0;
      body.on("data", (chunk) => {
        size += chunk.length;
        if (size > maximumBytes)
          finish(new Error("Probe response exceeds bound"));
        else chunks.push(chunk);
      });
      body.on("error", (error) => finish(error));
      body.on("aborted", () => finish(new Error("Probe response aborted")));
      body.on("end", () => {
        if (target.protocol === "https:" && httpsProtocol === "h2" && body.rstCode !== 0) {
          finish(new Error("Probe response reset before completion"));
          return;
        }
        finish(null, {
          response,
          text: Buffer.concat(chunks).toString("utf8"),
          blockedByAuthorization: false,
        });
      });
      body.on("close", () => {
        if (!settled)
          finish(new Error("Probe response closed before completion"));
      });
    }
    try {
      if (target.protocol === "https:" && httpsProtocol === "h2") {
        // Default strict TLS/ALPN h2. The Quarkus gateway explicitly uses HTTPS/1.1; no fallback.
        session = connect(target.origin, { settings: { enablePush: false } });
        session.on("error", (error) => finish(error));
        session.on("close", () => {
          if (!settled)
            finish(new Error("Probe session closed before completion"));
        });
        session.on("stream", (pushed) => pushed.destroy());
        const requestHeaders = {
          ":method": "GET",
          ":path": target.pathname,
          ...headers,
          [sensitiveHeaders]: [
            "cf-access-client-id",
            "cf-access-client-secret",
          ],
        };
        stream = session.request(requestHeaders, { endStream: true });
        stream.on("error", (error) => finish(error));
        stream.on("response", (received) =>
          collect(received[":status"], received, stream),
        );
      } else {
        stream = (target.protocol === "https:" ? httpsRequest : httpRequest)(
          target,
          { method: "GET", headers, agent: false },
          (response) =>
            collect(response.statusCode, response.headers, response),
        );
        stream.on("error", (error) => finish(error));
        stream.end();
      }
    } catch (error) {
      finish(error);
    }
  });
}
