import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function createStaticHandler(directory) {
  const root = realpath(resolve(directory));
  return async (request) => {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    try {
      const base = await root;
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname.includes("\0") || pathname.includes("\\"))
        return new Response("Bad request", { status: 400 });
      let path = await realpath(resolve(base, `.${pathname}`));
      const outside = (path) =>
        relative(base, path).startsWith("..") || isAbsolute(relative(base, path));
      if (outside(path)) return new Response("Not found", { status: 404 });
      const info = await stat(path);
      if (info.isDirectory()) {
        if (!pathname.endsWith("/")) {
          const url = new URL(request.url);
          url.pathname += "/";
          return Response.redirect(url, 308);
        }
        path = await realpath(resolve(path, "index.html"));
        if (outside(path)) return new Response("Not found", { status: 404 });
      }
      const file = Bun.file(path);
      const types = {
        ".wasm": "application/wasm",
        ".yaml": "application/yaml; charset=utf-8",
        ".rhai": "text/plain; charset=utf-8",
      };
      const extension = path.slice(path.lastIndexOf("."));
      return new Response(request.method === "HEAD" ? null : file, {
        headers: {
          "Content-Type": types[extension] ?? file.type,
          "Content-Length": String(file.size),
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return new Response("Not found", { status: error instanceof URIError ? 400 : 404 });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2] ?? "app-dist");
  await realpath(directory);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(process.env.PORT ?? 4175),
    fetch: createStaticHandler(directory),
  });
  console.log(`Minimal app: ${server.url} (${directory})`);
}
