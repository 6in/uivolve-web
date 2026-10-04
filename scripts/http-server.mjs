// Local-only, in-memory API for examples/host-http. No production storage.
let rows = [
  { id: 1, name: "りんご" },
  { id: 2, name: "みかん" },
];
let nextId = 3;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Item-Count",
};
const json = (value, status = 200) => Response.json(value, { status, headers });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4176,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (path === "/api/items" && request.method === "GET") return json(rows);
    if (path === "/api/items" && request.method === "HEAD")
      return new Response(null, { headers: { ...headers, "X-Item-Count": String(rows.length) } });
    const match = path.match(/^\/api\/items\/(\d+)$/);
    const index = match ? rows.findIndex((row) => row.id === Number(match[1])) : -1;
    if (match && index < 0) return json({ error: "not found" }, 404);
    if (match && request.method === "DELETE") {
      rows.splice(index, 1);
      return new Response(null, { status: 204, headers });
    }
    if (
      (path === "/api/items" && request.method === "POST") ||
      (match && ["PUT", "PATCH"].includes(request.method))
    ) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "JSON required" }, 400);
      }
      if (typeof body?.name !== "string" || !body.name.trim() || body.name.length > 200)
        return json({ error: "name required (1–200 characters)" }, 400);
      if (request.method === "POST") {
        const row = { id: nextId++, name: body.name };
        rows.push(row);
        return json(row, 201);
      }
      rows[index] = { id: rows[index].id, name: body.name };
      return json(rows[index]);
    }
    return json({ error: "not found" }, 404);
  },
});
console.log(`HTTP demo: ${server.url}api/items`);
