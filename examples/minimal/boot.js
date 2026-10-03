import { createApplication } from "../../src/application.js";

const error = document.getElementById("error");
const status = document.getElementById("status");
const choice = new URL(location.href).searchParams.get("renderer");
try {
  await createApplication({
    element: document.getElementById("app"),
    configUrl: new URL("./app.json", import.meta.url),
    wasmUrl: new URL("../../engine.wasm", import.meta.url),
    renderer: ["dom", "canvas"].includes(choice) ? choice : undefined,
    onError: (exception) => {
      error.textContent = exception?.message ?? "";
      error.hidden = !exception;
    },
    onBusy: (busy) => {
      status.textContent = busy
        ? "画面を読み込んでいます…"
        : "名前を入力して挨拶してみてください。";
    },
  });
} catch (exception) {
  error.hidden = false;
  error.textContent = exception.message;
  status.textContent = "起動できませんでした。";
}
