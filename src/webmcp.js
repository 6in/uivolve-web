// Compatibility facade for the bundled comparison demo.
import { SCREEN_CATALOG } from "./screen-catalog.js";
import { createUiTools as createTools } from "./ui-tools.js";
export { SCREEN_CATALOG } from "./screen-catalog.js";
export { registerUiTools } from "./ui-tools.js";
export function createUiTools(host) {
  return createTools(host, SCREEN_CATALOG);
}
