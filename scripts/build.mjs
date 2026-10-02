import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(
  "cargo",
  [
    "build",
    "--manifest-path",
    "engine/Cargo.toml",
    "--target",
    "wasm32-unknown-unknown",
    "--release",
    "--locked",
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(`${root}/public`, { recursive: true });
const module = new WebAssembly.Module(
  readFileSync(`${root}/engine/target/wasm32-unknown-unknown/release/wasm_ui_engine.wasm`),
);
const imports = WebAssembly.Module.imports(module);
if (imports.length)
  throw new Error(`The raw ABI engine unexpectedly requires imports: ${JSON.stringify(imports)}`);
copyFileSync(
  `${root}/engine/target/wasm32-unknown-unknown/release/wasm_ui_engine.wasm`,
  `${root}/public/engine.wasm`,
);
copyFileSync(`${root}/THIRD_PARTY_NOTICES.md`, `${root}/public/THIRD_PARTY_NOTICES.txt`);
console.log(`WASM engine: ${(statSync(`${root}/public/engine.wasm`).size / 1024).toFixed(0)} KiB`);
