// One size source for both renderers. The sizes live in src/runtime.css as custom
// properties; the DOM declarations reference them directly and the Canvas renderer
// resolves the same properties from its stage's computed style. Nothing here holds a
// number of its own, so there is no second size table to drift out of step.
//
// Resolution is per paint, not per character: call resolveFontMetrics() once when a
// frame starts and pass the result down to the drawing and measuring code.

export const FONT_SIZE_PROPERTIES = {
  meta: "--ui-font-size-meta",
  label: "--ui-font-size-label",
  caption: "--ui-font-size-caption",
  body: "--ui-font-size-body",
  close: "--ui-font-size-close",
  metric: "--ui-font-size-metric",
  icon: "--ui-font-size-icon",
};

export const FONT_ROLES = Object.keys(FONT_SIZE_PROPERTIES);

// The figure/document frame. The DOM SVG viewport is the element's content box, so the
// Canvas renderer has to inset by the same declared border before it fits the shared
// sprites; reading it here keeps the width in the stylesheet with everything else.
export const SURFACE_BORDER_PROPERTY = "--ui-surface-border-width";

// A missing stylesheet or an unusable value is an error, never a silent fallback: a
// wrong size has to stop the frame instead of painting characters nobody declared.
function pixels(style, role, property, { allowZero = false } = {}) {
  const raw = style.getPropertyValue(property).trim();
  const match = /^(\d+(?:\.\d+)?)px$/.exec(raw);
  if (!match)
    throw new Error(
      `フォントサイズ ${role} (${property}) をpx値として解決できません（取得値: "${raw}"）。` +
        "ランタイムCSSが読み込まれているか確認してください",
    );
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
    throw new Error(`フォントサイズ ${role} (${property}) が不正です（取得値: "${raw}"）`);
  return value;
}

export function resolveFontMetrics(stage) {
  const view = stage?.ownerDocument?.defaultView;
  if (!view) throw new Error("フォントサイズの解決には文書にマウント済みのステージ要素が必要です");
  const style = view.getComputedStyle(stage);
  const family = style.fontFamily.trim();
  if (!family) throw new Error("ステージの font-family を解決できません");
  const sizes = {};
  for (const [role, property] of Object.entries(FONT_SIZE_PROPERTIES))
    sizes[role] = pixels(style, role, property);
  return {
    family,
    sizes,
    surfaceBorder: pixels(style, "surface-border", SURFACE_BORDER_PROPERTY, { allowZero: true }),
    size(role) {
      const value = sizes[role];
      if (value === undefined)
        throw new Error(`未知のフォント役割 "${role}"（既知: ${FONT_ROLES.join(", ")}）`);
      return value;
    },
    // The Canvas `font` shorthand for a role. `family` is overridable for the monospace
    // roles only; everything else shares the stage's resolved family.
    font(role, weight = 400, familyOverride = family) {
      return `${weight} ${this.size(role)}px ${familyOverride}`;
    },
  };
}
