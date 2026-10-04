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
  const runtime = await createRuntime({
    element: document.querySelector("#app"),
    renderer: new URL(location.href).searchParams.get("renderer") === "canvas" ? "canvas" : "dom",
    baseUrl: new URL("./", import.meta.url),
    wasmUrl: new URL("../../engine.wasm", import.meta.url),
    connections: { api: { adapter: "http", baseUrl: "http://127.0.0.1:4177/api/" } },
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
