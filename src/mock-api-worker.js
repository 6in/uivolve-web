import { MockApiModel } from "./mock-api-model.js";
let model;
// Worker message events process synchronous operations serially in arrival order.
self.addEventListener("message", ({ data }) => {
  try {
    let result;
    if (data.operation === "init") {
      model = new MockApiModel(data.definition);
      result = true;
    } else {
      if (!model) throw new Error("Mock API is not initialized");
      if (data.operation === "request") result = model.request(data.request);
      else if (data.operation === "reset") result = model.reset();
      else throw new Error("Unknown mock operation");
    }
    self.postMessage({ id: data.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: data.id, ok: false, error: error.message });
  }
});
