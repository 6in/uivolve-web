// JSON-only deterministic mock API. Used inside a Worker and in contract tests.
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const name = /^[A-Za-z0-9_-]{1,80}$/;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const size = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
function keys(v, allowed) {
  if (!object(v) || Object.keys(v).some((k) => !allowed.includes(k)))
    throw new Error("Mock DSL: unknown field or invalid object");
}
const reply = (status, body = null) => ({
  status,
  headers: { "content-type": "application/json" },
  body,
});
export class MockApiModel {
  constructor(definition) {
    keys(definition, ["version", "collections", "routes"]);
    if (definition.version !== 1 || size(definition) > 1_000_000)
      throw new Error("Mock DSL: version 1 and at most 1 MB required");
    this.seed = new Map();
    keys(definition.collections ?? {}, Object.keys(definition.collections ?? {}));
    if (Object.keys(definition.collections ?? {}).length > 16)
      throw new Error("Mock DSL: at most 16 collections");
    for (const [id, collection] of Object.entries(definition.collections ?? {})) {
      keys(collection, ["key", "seed"]);
      if (
        !name.test(id) ||
        !name.test(collection.key) ||
        !Array.isArray(collection.seed) ||
        collection.seed.length > 1000
      )
        throw new Error("Mock DSL: invalid collection");
      const records = new Map();
      for (const record of collection.seed) {
        if (
          !object(record) ||
          !Object.hasOwn(record, collection.key) ||
          typeof record[collection.key] !== "string" ||
          !record[collection.key] ||
          records.has(record[collection.key])
        )
          throw new Error("Mock DSL: seed requires unique nonempty string keys");
        records.set(record[collection.key], structuredClone(record));
      }
      this.seed.set(id, { key: collection.key, records });
    }
    keys(definition.routes, Object.keys(definition.routes ?? {}));
    if (!Object.keys(definition.routes).length || Object.keys(definition.routes).length > 64)
      throw new Error("Mock DSL: 1..64 routes required");
    const signatures = new Set();
    this.routes = Object.entries(definition.routes)
      .map(([id, route]) => {
        keys(route, ["method", "path", "operation", "collection", "response"]);
        if (
          !name.test(id) ||
          !methods.includes(route.method) ||
          typeof route.path !== "string" ||
          route.path.length > 2048
        )
          throw new Error("Mock DSL: invalid route");
        const parts = route.path.split("/");
        if (
          parts.some(
            (p) =>
              !p ||
              p === "." ||
              p === ".." ||
              (!/^\{[A-Za-z0-9_-]+\}$/.test(p) && /[{}?#%\\]/.test(p)),
          )
        )
          throw new Error("Mock DSL: invalid relative route path");
        const signature =
          route.method + ":" + parts.map((p) => (p.startsWith("{") ? "{}" : p)).join("/");
        if (signatures.has(signature)) throw new Error("Mock DSL: duplicate route pattern");
        signatures.add(signature);
        const operation = route.operation;
        if (route.response !== undefined) {
          keys(route.response, ["status", "body"]);
          if (
            operation !== undefined ||
            route.collection !== undefined ||
            !Number.isInteger(route.response.status) ||
            route.response.status < 200 ||
            route.response.status > 599
          )
            throw new Error("Mock DSL: invalid fixed response");
          if ([204, 205, 304].includes(route.response.status) && route.response.body != null)
            throw new Error("Mock DSL: body forbidden for empty status");
        } else {
          const expected = {
            list: "GET",
            get: "GET",
            insert: "POST",
            update: "PATCH",
            delete: "DELETE",
            reset: "POST",
          };
          if (
            expected[operation] !== route.method ||
            (operation !== "reset" && !this.seed.has(route.collection)) ||
            (operation === "reset" && route.collection !== undefined)
          )
            throw new Error("Mock DSL: invalid operation or collection");
          const params = parts.filter((p) => p.startsWith("{"));
          if (
            ["get", "update", "delete"].includes(operation)
              ? params.length !== 1
              : params.length !== 0
          )
            throw new Error("Mock DSL: item operations require exactly one path variable");
        }
        return { ...structuredClone(route), parts };
      })
      .sort(
        (a, b) =>
          b.parts.filter((p) => !p.startsWith("{")).length -
          a.parts.filter((p) => !p.startsWith("{")).length,
      );
    this.reset();
  }
  reset() {
    this.collections = structuredClone(this.seed);
    this.sequence = 0;
    return reply(200, { reset: true });
  }
  request({ method, path, query = {}, body }) {
    if (
      !methods.includes(method) ||
      typeof path !== "string" ||
      path.length > 2048 ||
      !object(query) ||
      Object.keys(query).length
    )
      return reply(400, {
        message: "Unsupported method, path or query (query is not implemented)",
      });
    if (body !== undefined && size(body) > 100_000)
      return reply(413, { message: "Body exceeds 100 KB" });
    let parts;
    try {
      parts = path.split("/").map(decodeURIComponent);
    } catch {
      return reply(400, { message: "Invalid path encoding" });
    }
    if (parts.some((p) => !p || p === "." || p === ".." || /[/\\]/.test(p)))
      return reply(400, { message: "Invalid path segment" });
    const matches = this.routes.filter(
      (r) =>
        r.parts.length === parts.length &&
        r.parts.every((p, i) => p.startsWith("{") || p === parts[i]),
    );
    const route = matches.find((r) => r.method === method);
    if (!route) return reply(matches.length ? 405 : 404, { message: "No mock route" });
    if (route.response)
      return reply(
        route.response.status,
        method === "HEAD" ? null : structuredClone(route.response.body ?? null),
      );
    if (route.operation === "reset") return this.reset();
    const collection = this.collections.get(route.collection);
    const id = parts[route.parts.findIndex((p) => p.startsWith("{"))];
    const records = collection.records;
    if (route.operation === "list") return reply(200, structuredClone([...records.values()]));
    if (route.operation === "get")
      return records.has(id)
        ? reply(200, structuredClone(records.get(id)))
        : reply(404, { message: "Record not found" });
    if (route.operation === "delete") {
      if (!records.delete(id)) return reply(404, { message: "Record not found" });
      return reply(204);
    }
    if (!object(body)) return reply(400, { message: "Object body required" });
    let value;
    if (route.operation === "insert") {
      if (records.size >= 1000) return reply(413, { message: "Collection is full" });
      let key = Object.hasOwn(body, collection.key) ? body[collection.key] : undefined;
      if (key === undefined) {
        do {
          key = `M${++this.sequence}`;
        } while (records.has(key));
      }
      if (typeof key !== "string" || !key || records.has(key))
        return reply(409, { message: "Invalid or duplicate key" });
      value = { ...structuredClone(body), [collection.key]: key };
    } else {
      if (!records.has(id)) return reply(404, { message: "Record not found" });
      if (Object.hasOwn(body, collection.key) && body[collection.key] !== id)
        return reply(409, { message: "Key cannot change" });
      value = { ...records.get(id), ...structuredClone(body), [collection.key]: id };
    }
    const candidate = new Map(records);
    candidate.set(value[collection.key], value);
    const all = [...this.collections].map(([key, c]) => [
      key,
      [...(key === route.collection ? candidate : c.records).values()],
    ]);
    if (size(all) > 1_000_000) return reply(413, { message: "Mock data exceeds 1 MB" });
    records.set(value[collection.key], value);
    return reply(route.operation === "insert" ? 201 : 200, structuredClone(value));
  }
}
