import { createHash } from "node:crypto";

// Local fixtures only. The existing CRUD demo runs independently on 4176.
export const transferHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Content-Length, X-Transfer-Fixture",
  "X-Transfer-Fixture": "localhost",
};
const json = (value, status = 200) => Response.json(value, { status, headers: transferHeaders });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function digest(stream) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}
function integer(url, name, fallback, maximum) {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum)
    throw new Error(`Invalid ${name}`);
  return Number(value);
}
// Bun 1.3.12 drops .name on parsed zero-byte files. Read just the MIME
// headers for their filenames; formData still owns value/file decoding.
function multipartFilenames(bytes, contentType) {
  const boundary = contentType
    .match(/boundary=(?:"([^"]+)"|([^;\s]+))/)
    ?.slice(1)
    .find(Boolean);
  if (!boundary) throw new Error("Multipart boundary required");
  const data = Buffer.from(bytes);
  const separator = Buffer.from(`\r\n--${boundary}`);
  const filenames = [];
  let offset = 0;
  while (offset < data.length) {
    const start = data.indexOf("\r\n", offset);
    const end = data.indexOf("\r\n\r\n", start);
    if (start < 0 || end < 0) break;
    const headers = data.toString("utf8", start, end);
    filenames.push(headers.match(/;\s*filename="([^"]*)"/i)?.[1]);
    const next = data.indexOf(separator, end + 4);
    if (next < 0) break;
    offset = next + 2;
    if (
      data.subarray(offset + boundary.length + 2, offset + boundary.length + 4).toString() === "--"
    )
      break;
  }
  return filenames;
}
export async function transferFixture(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, "");
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: transferHeaders });
  try {
    const delay = integer(url, "delay", 0, 5000);
    if (delay) await pause(delay);
    if (path === "status") {
      const status = integer(url, "code", 503, 599);
      if (status < 400) return json({ error: "Expected error status" }, 400);
      return json({ error: "Fixture rejection" }, status);
    }
    if (path === "auth" && request.headers.get("Authorization") !== "Bearer transfer-fixture")
      return json({ error: "Fixture authentication required" }, 401);
    if (path === "auth") return json({ authenticated: true });
    if (path === "invalid-json")
      return new Response("{broken", {
        headers: { ...transferHeaders, "Content-Type": "application/json" },
      });
    if (path === "invalid-utf8")
      return new Response(new Uint8Array([255]), { headers: transferHeaders });
    if (path === "csv" && request.method === "GET")
      return new Response("name,quantity\napple,2\norange,3\n", {
        headers: { ...transferHeaders, "Content-Type": "text/csv; charset=utf-8" },
      });
    if (path === "download" && request.method === "GET") {
      const size = integer(url, "size", 1048576, 128 * 1024 * 1024);
      const chunkDelay = integer(url, "chunkDelay", 0, 5000);
      // Known-length fixtures use a Blob because Bun strips Content-Length
      // from ReadableStream responses. Delayed/unknown-length fixtures stream.
      if (url.searchParams.get("length") !== "no" && chunkDelay === 0)
        return new Response(new Blob([new Uint8Array(size).fill(97)]), {
          headers: {
            ...transferHeaders,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(size),
          },
        });
      let sent = 0;
      const body = new ReadableStream({
        async pull(controller) {
          if (sent === size) {
            controller.close();
            return;
          }
          if (chunkDelay) await pause(chunkDelay);
          const chunk = new Uint8Array(Math.min(65536, size - sent)).fill(97);
          sent += chunk.length;
          controller.enqueue(chunk);
        },
      });
      const headers = { ...transferHeaders, "Content-Type": "application/octet-stream" };
      return new Response(body, { headers });
    }
    if (path === "upload" && ["POST", "PUT"].includes(request.method))
      return json({ method: request.method, ...(await digest(request.body)) });
    if (path === "multipart" && ["POST", "PUT"].includes(request.method)) {
      const bytes = await request.arrayBuffer();
      const filenames = multipartFilenames(bytes, request.headers.get("content-type") ?? "");
      const form = await new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bytes,
      }).formData();
      const entries = [];
      for (const [name, value] of form) {
        entries.push(
          typeof value === "string"
            ? { name, value }
            : {
                name,
                filename: value.name ?? filenames[entries.length],
                type: value.type,
                ...(await digest(value.stream())),
              },
        );
      }
      return json({ method: request.method, entries });
    }
    return json({ error: "not found" }, 404);
  } catch {
    return json({ error: "Invalid fixture request" }, 400);
  }
}
if (import.meta.main) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(process.argv[2] ?? 4177),
    maxRequestBodySize: 128 * 1024 * 1024,
    idleTimeout: 255,
    fetch: transferFixture,
  });
  console.log(JSON.stringify({ url: `${server.url}api/` }));
  const stop = () => {
    server.stop(true);
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
