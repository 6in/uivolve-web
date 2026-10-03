import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/engine.js";
import { parsePackage } from "../src/package-format.js";
import { createUiTools } from "../src/webmcp.js";
import { KanbanDrag, cardAt, dropAt, keyboardMove } from "../src/kanban-interaction.js";

let wasm, bytes, screen, script, engine, result;
beforeAll(async () => {
  bytes = await readFile(new URL("../public/engine.wasm", import.meta.url));
  wasm = await WebAssembly.compile(bytes);
  screen = parsePackage(
    await readFile(new URL("../public/screens/kanban.yaml", import.meta.url), "utf8"),
    "yaml",
  );
  script = await readFile(new URL("../public/screens/kanban.rhai", import.meta.url), "utf8");
});
beforeEach(async () => {
  engine = new WasmEngine((await WebAssembly.instantiate(wasm, {})).exports, bytes.length);
  result = engine.load(screen, script);
});
const move = (id, value, beforeId = null) =>
  (result = engine.dispatch("taskBoard", { action: "move", id, value, beforeId }));
const ids = (lane) => result.state.cards.filter((c) => c.lane === lane).map((c) => c.id);
const scene = () => engine.layout(500);
// Stale dialog events are explicitly ignored and expose the unchanged ABI result.
const snapshot = () => engine.dispatch(":dialog:stale");
const board = (pkg) => pkg.ui.items.find((n) => n.xtype === "kanban");
const card = (view, id) =>
  view.widgets.find((w) => w.kind === "kanban-card" && w.payload.id === id);
const lane = (view, id) =>
  view.widgets.find((w) => w.kind === "kanban-lane" && w.config.lane === id);
const plain = "fn init(s){s} fn cardMoved(s,e){s} fn resetBoard(s,e){s}";

it("loads downloaded YAML/Rhai, moves to an empty lane and preserves stable card keys", () => {
  const before = scene();
  const initialCards = structuredClone(result.state.cards);
  expect(ids("todo")).toEqual(["task-1", "task-2"]);
  expect(lane(before, "done").config.count).toBe(0);
  move("task-1", "done");
  expect(ids("todo")).toEqual(["task-2"]);
  expect(ids("done")).toEqual(["task-1"]);
  expect(result.state.moves).toBe(1);
  expect(result.state.notice).toContain("task-1 → 完了");
  expect(card(scene(), "task-1").key).toBe(card(before, "task-1").key);
  expect(card(scene(), "task-1").config.lane).toBe("done");
  expect(lane(scene(), "done").config.count).toBe(1);
  expect(engine.dispatch("resetBoard").state.cards).toEqual(initialCards);
});

it("reorders within a lane and inserts before a card across lanes without losing data", () => {
  const originals = structuredClone(result.state.cards);
  move("task-2", "todo", "task-1");
  expect(ids("todo")).toEqual(["task-2", "task-1"]);
  move("task-2", "todo");
  expect(ids("todo")).toEqual(["task-1", "task-2"]);
  move("task-1", "doing", "task-4");
  expect(ids("doing")).toEqual(["task-3", "task-1", "task-4"]);
  expect(result.state.cards.find((c) => c.id === "task-1")).toEqual({
    ...originals[0],
    lane: "doing",
  });
  expect(new Set(result.state.cards.map((c) => c.id)).size).toBe(4);
});

it("gives Rhai the original lane and insertion ID after the tentative move", () => {
  const pkg = structuredClone(screen);
  delete pkg.stateSchema;
  engine.load(
    pkg,
    script.replace(
      "state.moves += 1;",
      "state.sourceLane = event.oldValue; state.before = event.beforeId; state.moves += 1;",
    ),
  );
  move("task-1", "doing", "task-4");
  expect(result.state.sourceLane).toBe("todo");
  expect(result.state.before).toBe("task-4");
});

it("keeps typed state intact when a handler returns a schema violation", () => {
  result = engine.load(screen, script.replace("state.moves += 1;", 'state.moves = "invalid";'));
  const before = snapshot();
  expect(() => move("task-1", "done")).toThrow(/moves|integer/);
  expect(snapshot()).toEqual(before);
});

it("rolls back the card, ordering, state and revision when Rhai refuses a move", () => {
  result = engine.dispatch("reviewRequired", { value: true });
  const before = structuredClone(result);
  expect(() => move("task-1", "done")).toThrow(/レビュー待ち/);
  expect(snapshot()).toEqual(before);
  result = engine.dispatch("reviewRequired", { value: false });
  move("task-1", "done");
  expect(result.state.moves).toBe(1);
});

it.each([
  { id: "missing", value: "done" },
  { id: "task-1", value: "unknown" },
  { id: "task-1", value: "done", beforeId: "task-2" },
  { id: "task-1", value: "todo", beforeId: "task-1" },
  { id: "task-1", value: "todo", beforeId: 4 },
  { id: 1, value: "done" },
  { id: "task-1", value: 2 },
  { action: "delete", id: "task-1", value: "done" },
])("rejects an invalid move atomically: %j", (payload) => {
  const before = structuredClone(result);
  const beforeScene = scene();
  expect(() => engine.dispatch("taskBoard", { action: "move", ...payload })).toThrow();
  expect(snapshot()).toEqual(before);
  expect(scene()).toEqual(beforeScene);
});

it.each(["readonly", "disabled", "card-disabled", "modal"])(
  "guards %s at the engine as well as the interaction adapter",
  (guard) => {
    const pkg = structuredClone(screen);
    pkg.state.cards = result.state.cards;
    const n = board(pkg);
    if (guard === "readonly") n.readOnly = true;
    if (guard === "disabled") n.disabled = true;
    if (guard === "card-disabled") pkg.state.cards[0].disabled = true;
    if (guard === "modal")
      pkg.ui.items.push({
        xtype: "window",
        itemId: "modal",
        visibleBind: "showModal",
        title: "確認",
        items: [],
      });
    if (guard === "modal") pkg.state.showModal = true;
    delete pkg.stateSchema;
    result = engine.load(pkg, plain);
    const before = structuredClone(result);
    if (["readonly", "card-disabled"].includes(guard))
      expect(() => move("task-1", "done")).toThrow(/read-only|disabled/);
    else move("task-1", "done");
    expect(snapshot()).toEqual(before);
    expect(card(scene(), "task-1").disabled).toBe(true);
    expect(
      cardAt(scene(), card(scene(), "task-1").x + 10, card(scene(), "task-1").y + 10),
    ).toBeNull();
  },
);

it.each([240, 500, 900])("lays out each card inside its lane at width %s", (width) => {
  const view = engine.layout(width);
  const lanes = view.widgets.filter((w) => w.kind === "kanban-lane");
  expect(lanes).toHaveLength(3);
  for (const w of view.widgets.filter((w) => w.kind === "kanban-card")) {
    const parent = lanes.find((l) => l.config.lane === w.config.lane);
    expect(w.x).toBeGreaterThanOrEqual(parent.x);
    expect(w.x + w.width).toBeLessThanOrEqual(parent.x + parent.width + 0.01);
    expect(w.y + w.height).toBeLessThanOrEqual(parent.y + parent.height);
    expect(w.y + w.height).toBeLessThanOrEqual(view.height);
  }
  if (width === 240) expect(lanes[1].y).toBeGreaterThan(lanes[0].y + lanes[0].height);
  else expect(lanes[1].y).toBe(lanes[0].y);
});

it("validates card/lane configuration and handler results before committing", () => {
  const modifications = [
    (p) => {
      board(p).lanes[1].id = "todo";
    },
    (p) => {
      board(p).lanes = [];
    },
    (p) => {
      board(p).bind = "nested.cards";
    },
    (p) => {
      board(p).itemId = "";
    },
    (p) => {
      p.state.cards[0].id = "bad:id";
    },
    (p) => {
      p.state.cards[0].lane = "missing";
    },
    (p) => {
      p.state.cards[1].id = p.state.cards[0].id;
    },
    (p) => {
      p.state.cards[0].description = 42;
    },
    (p) => {
      p.state.cards = Array.from({ length: 101 }, (_, i) => ({
        id: `task-${i}`,
        title: "多い",
        lane: "todo",
      }));
    },
    (p) => {
      p.ui.lanes = [{ id: "todo", title: "未着手" }];
    },
  ];
  const previous = snapshot().state;
  for (const change of modifications) {
    const pkg = structuredClone(screen);
    delete pkg.stateSchema;
    pkg.state.cards = structuredClone(previous.cards);
    change(pkg);
    expect(() => engine.load(pkg, plain)).toThrow(/kanban|lanes/);
    expect(snapshot().state).toEqual(previous);
  }
  const pkg = structuredClone(screen);
  delete pkg.stateSchema;
  engine.load(
    pkg,
    script.replace("state.moves += 1;", 'state.cards[0].lane = "missing"; state.moves += 1;'),
  );
  expect(() => move("task-1", "doing")).toThrow(/kanban/);
  expect(snapshot().state).toEqual(previous);
});

it("operates the same board through WebMCP with insertion IDs and stale revision protection", async () => {
  const tools = createUiTools({
    snapshot: () => ({
      screen: { id: "kanban", token: "test-generation" },
      revision: result.revision,
      state: result.state,
      scene: scene(),
      busy: false,
    }),
    dispatch: (target, payload) => {
      result = engine.dispatch(target, payload);
    },
  });
  const call = (name, args = {}) => tools.find((t) => t.name === name).execute(args);
  const view = await call("ui_get_screen");
  const w = view.widgets.find((w) => w.key === "taskBoard:card:task-1");
  expect(w.actions).toEqual(["move"]);
  expect(w.metadata.webmcp.label).toBe("タスクボード");
  const args = {
    screenToken: "test-generation",
    revision: result.revision,
    key: w.key,
    payload: { value: "doing", beforeId: "task-4" },
  };
  expect((await call("ui_dispatch", args)).ok).toBe(true);
  expect(ids("doing")).toEqual(["task-3", "task-1", "task-4"]);
  expect((await call("ui_dispatch", args)).error.code).toBe("STALE_SCREEN");
  expect(
    (await call("ui_dispatch", { ...args, revision: result.revision, payload: { beforeId: 4 } }))
      .error.code,
  ).toBe("INVALID_INPUT");
});

class Stage extends EventTarget {
  capture = null;
  getBoundingClientRect() {
    return { left: 50, top: 80, width: 1000, height: scene().height * 2 };
  }
  setPointerCapture(id) {
    this.capture = id;
  }
  hasPointerCapture(id) {
    return this.capture === id;
  }
  releasePointerCapture() {
    this.capture = null;
  }
  pointer(type, x, y, extras = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 50 + x * 2,
      clientY: 80 + y * 2,
      ...extras,
    });
    this.dispatchEvent(event);
  }
}
function interaction() {
  const stage = new Stage();
  const emissions = [];
  const previews = [];
  const drag = new KanbanDrag(stage, {
    focus: () => {},
    change: (p) => previews.push(p),
    dispatch: (target, payload) => {
      emissions.push(payload);
      result = engine.dispatch(target, payload);
    },
  });
  drag.setScene(scene());
  return { stage, drag, emissions, previews };
}
const center = (w) => [w.x + w.width / 2, w.y + w.height / 2];

it("shares drop geometry for empty lanes, insertion positions and keyboard moves", () => {
  const view = scene();
  const source = card(view, "task-1");
  const destination = lane(view, "doing");
  expect(dropAt(view, source, destination.x + 15, destination.y + 45).beforeId).toBe("task-3");
  expect(
    dropAt(view, source, destination.x + 15, destination.y + destination.height - 5).beforeId,
  ).toBeNull();
  expect(dropAt(view, source, ...center(lane(view, "done"))).beforeId).toBeNull();
  expect(dropAt(view, source, -10, -10)).toBeNull();
  expect(keyboardMove(view, source, "ArrowRight")).toMatchObject({
    value: "doing",
    beforeId: null,
  });
  expect(keyboardMove(view, source, "ArrowLeft")).toBeNull();
  expect(keyboardMove(view, source, "ArrowDown")).toMatchObject({ value: "todo", beforeId: null });
  expect(keyboardMove(view, card(view, "task-2"), "ArrowUp").beforeId).toBe("task-1");
  expect(keyboardMove(view, card(view, "task-2"), "ArrowDown")).toBeNull();
});

it("commits one drop after movement, translates scaled coordinates and never updates state during preview", () => {
  const { stage, drag, emissions } = interaction();
  const source = card(scene(), "task-1"),
    destination = lane(scene(), "done");
  const before = snapshot();
  stage.pointer("pointerdown", ...center(source));
  stage.pointer("pointermove", ...center(destination));
  expect(drag.drag.active).toBe(true);
  expect(drag.drag.drop.lane.config.lane).toBe("done");
  expect(snapshot()).toEqual(before);
  stage.pointer("pointerup", ...center(destination));
  expect(emissions).toHaveLength(1);
  expect(ids("done")).toEqual(["task-1"]);
  expect(stage.capture).toBeNull();
  expect(drag.drag).toBeNull();
  drag.dispose();
});

it("ignores short movement, no-op drops, other pointer IDs and events after disposal", () => {
  const { stage, drag, emissions } = interaction();
  const source = card(scene(), "task-1");
  const [x, y] = center(source);
  stage.pointer("pointerdown", x, y);
  stage.pointer("pointermove", x + 3, y + 1);
  expect(drag.drag.active).toBe(false);
  stage.pointer("pointermove", x + 50, y, { pointerId: 2 });
  expect(drag.drag.active).toBe(false);
  stage.pointer("pointerup", x + 3, y + 1);
  stage.pointer("pointerdown", x, y);
  stage.pointer("pointermove", x + 6, y);
  stage.pointer("pointerup", x + 6, y);
  expect(emissions).toHaveLength(0);
  drag.dispose();
  stage.pointer("pointerdown", x, y);
  stage.pointer("pointermove", ...center(lane(scene(), "done")));
  stage.pointer("pointerup", ...center(lane(scene(), "done")));
  expect(drag.drag).toBeNull();
  expect(emissions).toHaveLength(0);
});

it.each(["click", "outside", "cancel", "escape", "scene-change", "capture-lost", "dispose"])(
  "does not emit a move on %s",
  (reason) => {
    const { stage, drag, emissions } = interaction();
    const source = card(scene(), "task-1"),
      destination = lane(scene(), "done");
    const before = snapshot();
    stage.pointer("pointerdown", ...center(source));
    if (reason !== "click") stage.pointer("pointermove", ...center(destination));
    if (reason === "outside") stage.pointer("pointerup", -10, -10);
    else if (reason === "cancel") stage.pointer("pointercancel", ...center(destination));
    else if (reason === "escape")
      stage.dispatchEvent(
        Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }),
      );
    else if (reason === "scene-change") drag.setScene(scene());
    else if (reason === "capture-lost") stage.pointer("lostpointercapture", ...center(destination));
    else if (reason === "dispose") drag.dispose();
    else stage.pointer("pointerup", ...center(source));
    expect(emissions).toHaveLength(0);
    expect(snapshot()).toEqual(before);
    expect(drag.drag).toBeNull();
    drag.dispose();
  },
);
