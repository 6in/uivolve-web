import { createRuntime } from "../../src/runtime.js";
import { generateLargeFile } from "./large-file.js";

const showError = (error) => {
  document.querySelector("#error").textContent = error?.message ?? "";
};
document.querySelector("#generate").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  document.querySelector("#generated").textContent = "100 MiBを生成中…";
  try {
    const size = await generateLargeFile();
    document.querySelector("#generated").textContent =
      `${size} bytes生成完了。本文アップロードを選べます。`;
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
});
try {
  const parameters = new URL(location.href).searchParams;
  const runtime = await createRuntime({
    element: document.querySelector("#app"),
    renderer: new URL(location.href).searchParams.get("renderer") === "canvas" ? "canvas" : "dom",
    baseUrl: new URL("./", location.href),
    wasmUrl: new URL("../../engine.wasm", import.meta.url),
    connections: {
      api: { adapter: "http", baseUrl: parameters.get("api") ?? "http://127.0.0.1:4177/api/" },
    },
    onError: showError,
  });
  try {
    const candidate = await runtime.load("home.yaml");
    const testScope = parameters.get("testScope");
    if (testScope && /^transfer-test-[A-Za-z0-9_-]+$/.test(testScope)) {
      runtime.compile(
        { ...candidate.screen, id: testScope },
        candidate.script,
        new URL("home.yaml", import.meta.url),
      );
      window.transferTestRuntime = runtime;
    }
    window.addEventListener("pagehide", () => runtime.dispose(), { once: true });
  } catch (error) {
    runtime.dispose();
    throw error;
  }
} catch (error) {
  showError(error);
}
