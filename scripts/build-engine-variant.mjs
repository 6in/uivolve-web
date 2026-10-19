import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const WASM_RELATIVE = "wasm32-unknown-unknown/release/wasm_ui_engine.wasm";

export const MUTATIONS = [
  {
    name: "layout-x-offset",
    file: "engine/src/lib.rs",
    from: "        arrange(\n            &self.root.ui,\n            &state,\n            16.0,\n",
    to: "        arrange(\n            &self.root.ui,\n            &state,\n            17.0,\n",
    diff: "layout:* の data.widgets[*].x",
  },
  {
    name: "dialog-draft-revision",
    file: "engine/src/lib.rs",
    from: "                dialogs::Event::Draft => {\n                    self.revision += 1;\n",
    to: "                dialogs::Event::Draft => {\n",
    diff: "dialog-prompt-input の data.revision",
  },
  {
    name: "unknown-item-message",
    file: "engine/src/lib.rs",
    from: '"Unknown itemId: {target}"',
    to: '"Unknown item: {target}"',
    diff: "abi-errors の event:unknown-target の error",
  },
  // Composition only shows up on screens the parity harness skips, so these two are checked by
  // scripts/probe-composition.mjs instead of the base comparison.
  {
    name: "emit-skips-listener",
    probe: "composition",
    file: "engine/src/lib.rs",
    from: "node.listeners.get(&name)",
    to: 'node.listeners.get("\\0 no listener")',
    diff: "order-dashboard の event:open/orders の state.notice",
  },
  {
    name: "config-diff-ignored",
    probe: "composition",
    file: "engine/src/lib.rs",
    from: "            if config == resolve(&committed)? {",
    to: "            if true || config == resolve(&committed)? {",
    diff: "order-dashboard の layout:800:filtered の行数",
  },
  {
    name: "instance-dropped",
    probe: "composition",
    file: "engine/src/lib.rs",
    from: '                    object.insert("instance".to_owned(), json!(path));',
    to: "                    object.remove(path.as_str());",
    diff: "parts-lab の event:products/loadProducts の effects[*].instance",
  },
  {
    name: "completion-routed-to-root",
    probe: "composition",
    file: "engine/src/lib.rs",
    from: "                let target = match instance.is_empty() {",
    to: "                let target = match true {",
    diff: "parts-lab の http_result:products が Unknown or completed",
  },
  {
    name: "components-omitted",
    probe: "composition",
    file: "engine/src/lib.rs",
    from: "components: self.component_summaries()?,",
    to: "components: Vec::new(),",
    diff: "child-webmcp-published の layout:800 の data.components",
  },
];

function parseArgs(argv) {
  const options = { commit: null, mutation: null, out: null, scratch: "target/engine-compare" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in options) || argv[i] === key || argv[i + 1] === undefined) return null;
    options[key] = argv[i + 1];
  }
  if (!options.out) return null;
  if (!options.commit === !options.mutation) return null;
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function cargoBuild(manifestPath, targetDir) {
  return run("cargo", [
    "build",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--locked",
    "--manifest-path",
    manifestPath,
    "--target-dir",
    targetDir,
  ]);
}

function publish(targetDir, out) {
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(targetDir, WASM_RELATIVE), out);
  console.log(`wasm: ${out}`);
}

function buildCommit({ commit, out, targetDir, worktree }) {
  if (run("git", ["worktree", "add", "--detach", worktree, commit]) !== 0) return 1;
  try {
    if (cargoBuild(join(worktree, "engine/Cargo.toml"), targetDir) !== 0) return 1;
    publish(targetDir, out);
    return 0;
  } finally {
    run("git", ["worktree", "remove", "--force", worktree]);
  }
}

function buildMutation({ mutation, out, targetDir, scratch }) {
  const dir = join(scratch, `mutant-${mutation.name}`);
  rmSync(dir, { recursive: true, force: true });
  const engineTarget = resolve(root, "engine/target");
  cpSync(resolve(root, "engine"), join(dir, "engine"), {
    recursive: true,
    filter: (src) => src !== engineTarget,
  });
  cpSync(resolve(root, "public/themes"), join(dir, "public/themes"), { recursive: true });
  const file = join(dir, mutation.file);
  const source = readFileSync(file, "utf8");
  const count = source.split(mutation.from).length - 1;
  if (count !== 1) {
    console.error(
      `mutation ${mutation.name}: from が ${count} 回出現（1 回でなければ中止）: ${mutation.file}`,
    );
    return 2;
  }
  writeFileSync(file, source.replace(mutation.from, mutation.to));
  if (cargoBuild(join(dir, "engine/Cargo.toml"), targetDir) !== 0) return 1;
  publish(targetDir, out);
  return 0;
}

export function buildEngineVariant(argv) {
  const options = parseArgs(argv);
  if (!options) {
    console.error(
      "usage: bun scripts/build-engine-variant.mjs (--commit <rev> | --mutation <name>) --out <wasm> [--scratch <dir>]",
    );
    return 2;
  }
  const scratch = resolve(root, options.scratch);
  const targetDir = join(scratch, "cargo-target");
  const out = resolve(root, options.out);
  mkdirSync(scratch, { recursive: true });
  const started = Date.now();
  let code;
  if (options.commit) {
    code = buildCommit({
      commit: options.commit,
      out,
      targetDir,
      worktree: join(scratch, `worktree-${options.commit}`),
    });
  } else {
    const mutation = MUTATIONS.find((m) => m.name === options.mutation);
    if (!mutation) {
      console.error(
        `unknown mutation: ${options.mutation}（${MUTATIONS.map((m) => m.name).join(" / ")}）`,
      );
      return 2;
    }
    code = buildMutation({ mutation, out, targetDir, scratch });
  }
  console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = buildEngineVariant(process.argv.slice(2));
}
