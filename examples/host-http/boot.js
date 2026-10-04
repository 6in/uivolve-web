import { createRuntime } from "../../src/runtime.js";

const showError = (error) => {
  document.querySelector("#error").textContent = error?.message ?? "";
};
try {
  const runtime = await createRuntime({
    element: document.querySelector("#app"),
    renderer: new URL(location.href).searchParams.get("renderer") === "canvas" ? "canvas" : "dom",
    baseUrl: new URL("./", import.meta.url),
    wasmUrl: new URL("../../engine.wasm", import.meta.url),
    connections: { api: { adapter: "http", baseUrl: "http://127.0.0.1:4176/api/" } },
    onError: showError,
  });
  try {
    await runtime.load("home.yaml");
    window.addEventListener("pagehide", () => runtime.dispose(), { once: true });
  } catch (error) {
    runtime.dispose();
    throw error;
  }
} catch (error) {
  showError(error);
}
