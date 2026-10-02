const applied = new WeakMap();

// Both rendering adapters consume the resolved palette from the WASM scene.
export function applyTheme(element, theme) {
  const signature = JSON.stringify(theme);
  if (applied.get(element) === signature) return;
  for (const [key, color] of Object.entries(theme.colors)) {
    const cssKey = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    element.style.setProperty(`--ui-${cssKey}`, color);
  }
  element.style.colorScheme = theme.mode;
  element.dataset.themeMode = theme.mode;
  element.dataset.themeName = theme.name;
  applied.set(element, signature);
}
