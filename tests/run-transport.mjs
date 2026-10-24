import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Generate throwaway localhost credentials. No certificate/private key enters Git
// or production trust, and the child test runner's extra CA is process-scoped.
const directory = await mkdtemp(join(tmpdir(), "example-status-tls-"));
try {
  const certificate = join(directory, "localhost-cert.pem");
  const key = join(directory, "localhost-key.pem");
  const generated = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  if (generated.status !== 0)
    throw new Error(
      "OpenSSL must generate the temporary localhost test certificate",
    );
  const environment = {
    ...process.env,
    STATUS_TEST_TLS_DIRECTORY: directory,
    NODE_EXTRA_CA_CERTS: certificate,
  };
  delete environment.NODE_TLS_REJECT_UNAUTHORIZED;
  const child = spawn(
    process.execPath,
    [
      "--test",
      ...process.argv.slice(2),
      fileURLToPath(
        new URL("./transport.test.mjs", import.meta.url),
      ),
    ],
    { env: environment, stdio: "inherit" },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
