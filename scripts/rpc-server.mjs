import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Code, ConnectError } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { echoService } from "./rpc-schema.mjs";

export function createRpcServer() {
  const handler = connectNodeAdapter({
    routes(router) {
      router.service(echoService, {
        async echo(request, context) {
          if (request.name === "error")
            throw new ConnectError("サンプルの入力エラー", Code.InvalidArgument);
          if (request.name === "slow")
            await new Promise((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer);
                reject(context.signal.reason);
              };
              const timer = setTimeout(() => {
                context.signal.removeEventListener("abort", abort);
                resolve();
              }, 2000);
              context.signal.addEventListener("abort", abort, { once: true });
            });
          return {
            name: `Hello ${request.name}`,
            sequenceId: request.sequenceId,
            payload: request.payload,
          };
        },
      });
    },
  });
  return createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms, X-Grpc-Web, Grpc-Timeout",
    );
    response.setHeader("Access-Control-Expose-Headers", "Grpc-Status, Grpc-Message");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    handler(request, response);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.UIVOLVE_RPC_PORT ?? 4180);
  const server = createRpcServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(`Unary RPC demo: http://127.0.0.1:${port}/uivolve.demo.EchoService/Echo`),
  );
}
