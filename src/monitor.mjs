import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStatusServer } from "./server.mjs";
import { loadProfile, validateProfile } from "./profile.mjs";
import { probe } from "./probes.mjs";
import {
  loadState,
  observe,
  publicStatus,
  saveState,
} from "./status-state.mjs";

function integer(value, minimum, maximum, name) {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`Missing or invalid ${name}`);
  const number = Number(value);
  if (number < minimum || number > maximum)
    throw new Error(`Out of bounds ${name}`);
  return number;
}
function publicUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid public probe ${name}`);
  }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    throw new Error(`Invalid public probe ${name}`);
  return url.href;
}
export function configuration(environment = process.env, profile) {
  const stateDirectory = environment.STATUS_STATE_DIRECTORY;
  const bundleDirectory = environment.STATUS_BUNDLE_DIRECTORY;
  if (
    !stateDirectory ||
    !isAbsolute(stateDirectory) ||
    !bundleDirectory ||
    !isAbsolute(bundleDirectory)
  )
    throw new Error("Absolute state and bundle directories are required");
  if (environment.STATUS_HOST !== "127.0.0.1")
    throw new Error(
      "Status listener must bind to loopback behind the independent proxy",
    );
  const intervalMs = integer(
    environment.STATUS_INTERVAL_MS,
    5_000,
    300_000,
    "STATUS_INTERVAL_MS",
  );
  const timeoutMs = integer(
    environment.STATUS_TIMEOUT_MS,
    100,
    30_000,
    "STATUS_TIMEOUT_MS",
  );
  const validForMs = integer(
    environment.STATUS_VALID_FOR_MS,
    intervalMs * 2,
    intervalMs * 10,
    "STATUS_VALID_FOR_MS",
  );
  if (timeoutMs >= intervalMs)
    throw new Error("Probe timeout must be shorter than interval");
  const clientId = environment.STATUS_ACCESS_CLIENT_ID;
  const clientSecret = environment.STATUS_ACCESS_CLIENT_SECRET;
  if (
    Boolean(clientId) !== Boolean(clientSecret) ||
    [clientId, clientSecret].some(
      (value) =>
        value && (!/^[\x21-\x7e]+$/.test(value) || value.length > 4096),
    )
  )
    throw new Error(
      "Cloudflare Access credentials must be a valid complete pair",
    );
  validateProfile(profile);
  const targets = Object.fromEntries(Object.entries(profile.targetVariables).map(([name, variable]) => [name, publicUrl(environment[variable], variable)]));
  const stateFile = environment.STATUS_STATE_FILE ?? "observations.json";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.json$/.test(stateFile))
    throw new Error("Invalid status state filename");
  return {
    stateFile,
    profile,
    targets,
    stateDirectory,
    bundleDirectory,
    host: "127.0.0.1",
    port: integer(environment.STATUS_PORT, 1024, 65535, "STATUS_PORT"),
    intervalMs,
    timeoutMs,
    validForMs,
    accessCredentials: clientId ? { clientId, clientSecret } : null,
  };
}
export async function loadConfiguration(environment = process.env) {
  const profile = await loadProfile(environment.STATUS_PROFILE_PATH);
  return configuration(environment, profile);
}
export async function createMonitor(
  config,
  { fetcher, clock = Date.now, persist = saveState } = {},
) {
  const statePath = join(config.stateDirectory, config.stateFile ?? "observations.json");
  let state = await loadState(statePath, config.profile);
  let pending = null;
  return {
    status: () => publicStatus(state, clock(), config.validForMs, config.profile),
    observe: () => {
      if (pending) return pending;
      pending = (async () => {
        const observation = await probe(config, fetcher);
        const candidate = observe(state, observation, clock(), config.profile);
        await persist(statePath, candidate, config.profile);
        state = candidate;
        return publicStatus(state, clock(), config.validForMs, config.profile);
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
export async function run(config) {
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  let server;
  let timer;
  let stopping = false;
  let pending;
  try {
    const monitor = await createMonitor(config);
    server = await createStatusServer(config.bundleDirectory, monitor.status);
    await new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolveListen);
    });
    const iterate = async () => {
      try {
        await monitor.observe();
      } catch {
        process.stderr.write(
          "Status observation could not be persisted; previous observation will expire.\n",
        );
      }
      if (!stopping)
        timer = setTimeout(() => {
          pending = iterate();
        }, config.intervalMs);
    };
    pending = iterate();
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      await pending;
      await new Promise((resolveClose) => server.close(resolveClose));
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    return { stop, server };
  } catch (error) {
    clearTimeout(timer);
    if (server?.listening)
      await new Promise((resolveClose) => server.close(resolveClose));
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.env.STATUS_MONITOR_LOCKED !== "1") {
    process.stderr.write(
      "Use the canonical run.sh launcher to hold the exclusive process lock.\n",
    );
    process.exitCode = 1;
  } else
    loadConfiguration().then(run).catch(() => {
      process.stderr.write(
        "Status monitor failed to start. Check configuration and persisted state.\n",
      );
      process.exitCode = 1;
    });
}
