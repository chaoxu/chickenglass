/**
 * Compatibility barrel for editor/browser test helpers.
 *
 * Keep imports from ./editor-test-helpers.mjs working while the helper
 * implementation lives in focused modules.
 */

export {
  DEFAULT_FIXTURE_OPEN_TIMEOUT_MS,
  DEFAULT_FIXTURE_SETTLE_MS,
  hasFixtureDocument,
  resolveFixtureDocument,
  resolveFixtureDocumentWithFallback,
} from "./fixture-test-helpers.mjs";
export {
  settleEditorLayout,
  waitForAnimationFrames,
  waitForDocumentStable,
  waitForSemanticReady,
  waitForSidebarReady,
} from "./editor-wait-helpers.mjs";
export {
  captureDebugState,
  checkFences,
  dump,
  getGeometrySnapshot,
  getMotionGuards,
  getRecorderStatus,
  getRenderState,
  getStructureState,
  getTreeDivs,
  getWatcherStatus,
} from "./editor-debug-helpers.mjs";
export * from "./editor-render-helpers.mjs";
export * from "./editor-state-helpers.mjs";
export * from "./editor-scenario-helpers.mjs";
export * from "./editor-navigation-helpers.mjs";
export * from "./editor-hover-preview-helpers.mjs";
