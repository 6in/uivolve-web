// Loaded over plain HTTP on a non-loopback IP by scripts/test-insecure-browser.mjs.
import { createRuntime, ResourceClient, workerMockAdapter } from "/runtime/index.js";

const baseUrl = new URL("/", location.href);
const errors = [];
const resources = new ResourceClient({ baseUrl });
const ready = createRuntime({
  element: document.getElementById("app"),
  baseUrl,
  resources,
  adapters: [workerMockAdapter({ resources })],
  connections: {
    ordersMock: {
      adapter: "worker-mock",
      baseUrl: new URL("mock-api/", baseUrl).href,
      definition: new URL("mock/orders-api.yaml", baseUrl).href,
    },
  },
  onError: (error) => {
    if (error) errors.push(error.message);
  },
});

globalThis.insecureContext = {
  errors,
  async load(path) {
    const ui = await ready;
    await ui.load(path);
    return ui.screenToken;
  },
};
