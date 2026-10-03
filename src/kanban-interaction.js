import { isBlocked } from "./widget-contract.js";

const contains = (widget, x, y) =>
  x >= widget.x && x < widget.x + widget.width && y >= widget.y && y < widget.y + widget.height;

export function cardAt(scene, x, y) {
  if (!scene || scene.popup) return null;
  return (
    [...scene.widgets]
      .reverse()
      .find((w) => w.kind === "kanban-card" && !isBlocked(w, scene) && contains(w, x, y)) ?? null
  );
}

// Return an insertion point, independent of the renderer and pointer event APIs.
export function dropAt(scene, card, x, y) {
  const lane = scene.widgets.find(
    (w) =>
      w.kind === "kanban-lane" &&
      w.target === card.target &&
      !isBlocked(w, scene) &&
      w.layer === card.layer &&
      contains(w, x, y),
  );
  if (!lane || scene.popup) return null;
  const cards = scene.widgets.filter(
    (w) =>
      w.kind === "kanban-card" &&
      w.target === card.target &&
      w.config.lane === lane.config.lane &&
      w.key !== card.key,
  );
  const before = cards.find((w) => y < w.y + w.height / 2);
  return {
    lane,
    beforeId: before?.payload.id ?? null,
    lineY: before
      ? before.y - 5
      : cards.length
        ? cards.at(-1).y + cards.at(-1).height + 5
        : lane.y + 46,
  };
}

export function movePayload(card, drop) {
  return {
    action: "move",
    id: card.payload.id,
    value: drop.lane.config.lane,
    beforeId: drop.beforeId,
  };
}

export function keyboardMove(scene, card, key) {
  if (card?.kind !== "kanban-card" || isBlocked(card, scene) || scene.popup) return null;
  const lanes = scene.widgets.filter((w) => w.kind === "kanban-lane" && w.target === card.target);
  const laneIndex = lanes.findIndex((w) => w.config.lane === card.config.lane);
  if (["ArrowLeft", "ArrowRight"].includes(key)) {
    const lane = lanes[laneIndex + (key === "ArrowLeft" ? -1 : 1)];
    return lane && !isBlocked(lane, scene) ? movePayload(card, { lane, beforeId: null }) : null;
  }
  const cards = scene.widgets.filter(
    (w) =>
      w.kind === "kanban-card" && w.target === card.target && w.config.lane === card.config.lane,
  );
  const index = cards.findIndex((w) => w.key === card.key);
  if (key === "ArrowUp" && index > 0)
    return movePayload(card, { lane: lanes[laneIndex], beforeId: cards[index - 1].payload.id });
  if (key === "ArrowDown" && index < cards.length - 1)
    return movePayload(card, {
      lane: lanes[laneIndex],
      beforeId: cards[index + 2]?.payload.id ?? null,
    });
  return null;
}

// Both renderers use pointer capture and the same threshold/drop geometry.
// Pointer motion is a local preview; only a valid drop emits a WASM event.
export class KanbanDrag {
  constructor(stage, { dispatch, focus, change }) {
    this.stage = stage;
    this.dispatch = dispatch;
    this.focus = focus;
    this.change = change;
    this.events = new AbortController();
    const options = { signal: this.events.signal, capture: true };
    stage.addEventListener("pointerdown", (event) => this.begin(event), options);
    stage.addEventListener("pointermove", (event) => this.move(event), options);
    stage.addEventListener("pointerup", (event) => this.finish(event), options);
    stage.addEventListener("pointercancel", () => this.cancel(), options);
    stage.addEventListener("lostpointercapture", () => this.cancel(), options);
    stage.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && this.drag) {
          event.preventDefault();
          event.stopPropagation();
          this.cancel();
        }
      },
      options,
    );
  }

  setScene(scene) {
    this.cancel();
    this.scene = scene;
  }

  point(event) {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * this.scene.width) / rect.width,
      y: ((event.clientY - rect.top) * this.scene.height) / rect.height,
    };
  }

  begin(event) {
    if (this.drag || event.button !== 0 || event.isPrimary === false || !this.scene) return;
    const point = this.point(event);
    const card = cardAt(this.scene, point.x, point.y);
    if (!card) return;
    event.preventDefault();
    this.focus(card);
    this.drag = {
      card,
      pointerId: event.pointerId,
      origin: point,
      x: card.x,
      y: card.y,
      active: false,
      drop: null,
    };
    this.stage.setPointerCapture(event.pointerId);
  }

  move(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const point = this.point(event);
    if (!drag.active && Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < 5) return;
    drag.active = true;
    drag.x = drag.card.x + point.x - drag.origin.x;
    drag.y = drag.card.y + point.y - drag.origin.y;
    drag.drop = dropAt(this.scene, drag.card, point.x, point.y);
    this.change(drag);
  }

  finish(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const point = this.point(event);
    const drop = drag.active ? dropAt(this.scene, drag.card, point.x, point.y) : null;
    const peers = this.scene.widgets.filter(
      (w) =>
        w.kind === "kanban-card" &&
        w.target === drag.card.target &&
        w.config.lane === drag.card.config.lane,
    );
    const nextId = peers[peers.findIndex((w) => w.key === drag.card.key) + 1]?.payload.id ?? null;
    const changed =
      drop && (drop.lane.config.lane !== drag.card.config.lane || drop.beforeId !== nextId);
    this.cancel();
    if (changed) this.dispatch(drag.card.target, movePayload(drag.card, drop));
  }

  cancel() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.stage.hasPointerCapture(drag.pointerId))
      this.stage.releasePointerCapture(drag.pointerId);
    this.change(null);
  }

  dispose() {
    this.cancel();
    this.scene = null;
    this.events.abort();
  }
}
