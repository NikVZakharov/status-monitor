import { requestProbe } from "./probe-transport.mjs";
import { validateProfile } from "./profile.mjs";

export function authorizationGate(response) {
  if (response.status === 401 || response.status === 403) return true;
  if (![301, 302, 303, 307, 308].includes(response.status)) return false;
  try {
    const location = new URL(response.headers.get("location"));
    return location.hostname.endsWith(".cloudflareaccess.com") && location.pathname.startsWith("/cdn-cgi/access/");
  } catch { return false; }
}
async function boundedText(response, maximumBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maximumBytes) { await response.body?.cancel().catch(() => {}); throw new Error("Probe response exceeds bound"); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function requester(config, fetcher) {
  return async (target, { accept, maximumBytes }) => {
    if (!Object.hasOwn(config.targets, target) || !["application/json", "text/html"].includes(accept)
        || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 262144)
      throw new Error("Invalid profile probe request");
    const headers = { accept, "cache-control": "no-cache" };
    if (config.accessCredentials) {
      headers["cf-access-client-id"] = config.accessCredentials.clientId;
      headers["cf-access-client-secret"] = config.accessCredentials.clientSecret;
    }
    if (!fetcher) return requestProbe(config.targets[target], headers, {
      maximumBytes, timeoutMs: config.timeoutMs, httpsProtocol: config.profile.httpsProtocol ?? "h2", discardBody: authorizationGate,
    });
    const response = await fetcher(config.targets[target], {
      method: "GET", redirect: "manual", credentials: "omit", headers, signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (authorizationGate(response)) {
      await response.body?.cancel();
      return { response, text: "", blockedByAuthorization: true };
    }
    return { response, text: await boundedText(response, maximumBytes), blockedByAuthorization: false };
  };
}
export async function probe(config, fetcher) {
  const profile = validateProfile(config.profile);
  return profile.probe({ request: requester(config, fetcher) });
}
