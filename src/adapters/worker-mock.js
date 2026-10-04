import { httpAdapter } from "./http.js";
import { createMockApi } from "../mock-api-client.js";
import { httpUrl } from "../http-policy.js";

export function workerMockAdapter({ resources, workerFactory } = {}) {
  const clients = new Map();
  let disposed = false;
  const http = httpAdapter({ resources });
  return {
    name: "worker-mock",
    actions: ["http.request"],
    validate(operation, connection, source) {
      const { definition, ...httpConnection } = connection;
      if (typeof definition !== "string" || !definition)
        throw new Error("Worker mock definition URL required");
      http.validate(operation, httpConnection, source);
      connection.baseUrl = httpConnection.baseUrl;
      connection.definition = httpUrl(definition, source).href;
    },
    async execute(operation, args, context) {
      if (disposed) throw new Error("Worker mock adapter closed");
      const key = context.connection.definition;
      if (!clients.has(key)) {
        const client = createMockApi({ url: key, resources, workerFactory });
        clients.set(key, client);
        void client.catch(() => {
          if (clients.get(key) === client) clients.delete(key);
        });
      }
      const api = await clients.get(key);
      if (disposed) throw new Error("Worker mock adapter closed");
      context.signal.throwIfAborted();
      const base = new URL(context.connection.baseUrl);
      const transport = httpAdapter({
        resources: {
          fetch: async (url, options) => {
            const request = {
              method: options.method,
              path: url.pathname.slice(base.pathname.length),
              query: Object.fromEntries(url.searchParams),
            };
            if (options.body) request.body = JSON.parse(new TextDecoder().decode(options.body));
            const result = await api.request(request, options.signal);
            return new Response(
              [204, 205, 304].includes(result.status) || options.method === "HEAD"
                ? null
                : JSON.stringify(result.body),
              { status: result.status, headers: result.headers },
            );
          },
        },
      });
      return transport.execute(operation, args, context);
    },
    dispose() {
      disposed = true;
      for (const client of clients.values())
        void client.then(
          (api) => api.dispose(),
          () => {},
        );
      clients.clear();
    },
  };
}
