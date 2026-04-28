/* global window */
/**
 * Pure debug-bridge snapshot helpers.
 *
 * Each function is a thin wrapper around a single `__cmDebug` or `__cfDebug`
 * call with no side effects on editor state. The companion mutating helpers
 * (activateStructureAtCursor, clearStructure, clearMotionGuards) live in
 * editor-test-helpers.mjs because they call into the layout-settle helpers.
 */

export async function getTreeDivs(page) {
  return page.evaluate(() => window.__cmDebug.tree());
}

export async function getTreeString(page) {
  return page.evaluate(() => window.__cmDebug.treeString());
}

/**
 * Check visibility of closing fence lines.
 * Returns an array of { line, visible, height, classes } objects.
 *
 * @param {import("playwright").Page} page
 * @param {number[]} lineNumbers - line numbers to check (e.g. [73, 77, 88])
 */
export async function checkFences(page, lineNumbers) {
  return page.evaluate((lines) => {
    return lines.map((ln) => {
      const info = window.__cmDebug.line(ln);
      if (!info) return { line: ln, visible: null, height: "no-el", classes: [], found: false };
      const { height, hidden, classes } = info;
      return { line: ln, visible: !hidden, height, classes, found: true };
    });
  }, lineNumbers);
}

export async function dump(page) {
  return page.evaluate(() => window.__cmDebug.dump());
}

export async function getRenderState(page) {
  return page.evaluate(() => window.__cmDebug.renderState());
}

export async function getRecorderStatus(page) {
  return page.evaluate(() => window.__cfDebug.recorderStatus());
}

export async function getWatcherStatus(page) {
  return page.evaluate(() => window.__cfDebug.watcherStatus());
}

export async function captureDebugState(page, label = null) {
  return page.evaluate((snapshotLabel) => window.__cfDebug.captureState(snapshotLabel), label);
}

export async function getGeometrySnapshot(page) {
  return page.evaluate(() => window.__cmDebug.geometry());
}

export async function getFenceState(page) {
  return page.evaluate(() => window.__cmDebug.fences());
}

export async function getLineInfo(page, lineNumber) {
  return page.evaluate((ln) => window.__cmDebug.line(ln), lineNumber);
}

export async function getSelectionState(page) {
  return page.evaluate(() => window.__cmDebug.selection());
}

export async function getStructureState(page) {
  return page.evaluate(() => window.__cmDebug.structure());
}

export async function getMotionGuards(page) {
  return page.evaluate(() => window.__cmDebug.motionGuards());
}

export async function getHistoryState(page) {
  return page.evaluate(() => window.__cmDebug.history());
}

export async function getSemanticState(page) {
  return page.evaluate(() => window.__cmDebug.semantics());
}

export async function isDebugLaneEnabled(page) {
  return page.evaluate(() => window.__cmDebug?.debugLaneEnabled?.() ?? false);
}
