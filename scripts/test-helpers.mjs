/**
 * Compatibility barrel for browser test helpers.
 *
 * Keep this import surface stable for existing scripts:
 *   import { connectEditor, openFile, getTreeDivs, checkFences, dump } from "./test-helpers.mjs";
 */

export {
  DEBUG_EDITOR_SELECTOR,
  MODE_BUTTON_SELECTOR,
} from "../src/debug/debug-bridge-contract.js";
export { createArgParser } from "./devx-cli.mjs";
export * from "./browser-failure-artifacts.mjs";
export * from "./browser-health.mjs";
export * from "./browser-lifecycle.mjs";
export * from "./browser-screenshot.mjs";
export * from "./editor-test-helpers.mjs";
