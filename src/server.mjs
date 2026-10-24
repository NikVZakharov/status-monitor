import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const mediaTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
export async function createStatusServer(bundleDirectory, getStatus) {
  const root = await realpath(bundleDirectory);
  return createServer(
    { requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
    async (request, response) => {
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("referrer-policy", "no-referrer");
      response.setHeader(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      try {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, {
            allow: "GET, HEAD",
            "cache-control": "no-store",
          });
          response.end();
          return;
        }
        const pathname = new URL(request.url, "http://status.local").pathname;
        let bytes;
        let contentType;
        let cacheControl = "no-cache";
        if (pathname === "/status.json") {
          bytes = Buffer.from(`${JSON.stringify(getStatus())}\n`);
          contentType = "application/json; charset=utf-8";
          cacheControl = "no-store";
        } else {
          const relative = decodeURIComponent(
            pathname === "/" ? "/index.html" : pathname,
          );
          if (
            relative.includes("\0") ||
            relative.split("/").some((part) => part.startsWith("."))
          )
            throw new Error("Blocked path");
          const candidate = await realpath(resolve(root, `.${relative}`));
          if (!candidate.startsWith(`${root}${sep}`))
            throw new Error("Blocked path");
          contentType = mediaTypes[extname(candidate)];
          if (!contentType) throw new Error("Unsupported file");
          const metadata = await stat(candidate);
          if (!metadata.isFile() || metadata.size > 20 * 1024 * 1024)
            throw new Error("Unsupported file size");
          bytes = await readFile(candidate);
          if (pathname.startsWith("/assets/"))
            cacheControl = "public, max-age=31536000, immutable";
        }
        response.writeHead(200, {
          "content-type": contentType,
          "cache-control": cacheControl,
          "content-length": bytes.length,
        });
        response.end(request.method === "HEAD" ? undefined : bytes);
      } catch {
        response.writeHead(404, { "cache-control": "no-store" });
        response.end();
      }
    },
  );
}
