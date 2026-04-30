export const CORE_DEBUG_GLOBAL_NAMES = ["__app", "__cfDebug"];
export const DEBUG_BRIDGE_REQUIRED_GLOBAL_NAMES = ["__app", "__editor", "__cfDebug"];
export const DEBUG_BRIDGE_READY_PROMISES = [
  { globalName: "__app", propertyName: "ready" },
  { globalName: "__editor", propertyName: "ready" },
  { globalName: "__cfDebug", propertyName: "ready" },
];
export const DEBUG_EDITOR_TEST_ID = "editor";
export const MODE_BUTTON_TEST_ID = "mode-button";
export const DEBUG_EDITOR_SELECTOR = `[data-testid="${DEBUG_EDITOR_TEST_ID}"]`;
export const MODE_BUTTON_SELECTOR = `[data-testid="${MODE_BUTTON_TEST_ID}"]`;
export const DEBUG_BRIDGE_DOC_ENTRIES = [
  ["__cmView", "CM6 EditorView (dispatch, state, focus)"],
  ["__cmDebug.tree()", "FencedDiv nodes from the Lezer syntax tree"],
  ["__cmDebug.treeString()", "full syntax tree as readable string"],
  ["__cmDebug.fences()", "closing fence visibility for all blocks"],
  ["__cmDebug.line(73)", "DOM state of a specific line"],
  ["__cmDebug.selection()", "current selection (anchor, head, from, to, line, col)"],
  ["__cmDebug.history()", "undo/redo depth"],
  ["__cmDebug.structure()", "active explicit structure-edit target (or null)"],
  ["__cmDebug.geometry()", "measured visible-line + shell-surface geometry snapshot"],
  ["__cmDebug.renderState()", "compact visible rich-render snapshot (raw fenced openers, rendered headers, rich-widget counts)"],
  ["__cmDebug.motionGuards()", "recent vertical-motion guard events"],
  ["__cmDebug.dump()", "combined snapshot (tree + fences + cursor + focus)"],
  ["__cmDebug.activateStructureAtCursor()", "open structure editing at the current cursor"],
  ["__cmDebug.clearStructure()", "clear the active structure-edit target"],
  ["__cmDebug.clearMotionGuards()", "clear recorded vertical-motion guard events"],
  ["__cmDebug.moveVertically(\"up\")", "rich-mode vertical move with reverse-scroll guard"],
  ["__cmDebug.toggleTreeView()", "toggle live Lezer tree panel (@overleaf/codemirror-tree-view)"],
  ["__app.openFile(\"posts/x.md\")", "open any file by path (app's real function)"],
  ["__app.hasFile(\"posts/x.md\")", "whether a project file exists"],
  ["__app.openFileWithContent(name, content)", "open generated content as an editor document"],
  ["__app.loadFixtureProject(files, initialPath)", "load an in-memory fixture project for tests"],
  ["__app.closeFile({ discard })", "close the active document"],
  ["__app.setSearchOpen(true)", "open or close app search"],
  ["__app.setMode(\"source\")", "switch editor mode (cm6-rich/source)"],
  ["__app.showSidebarPanel(\"diagnostics\")", "open a specific sidebar panel"],
  ["__app.getSidebarState()", "current sidebar { collapsed, tab }"],
  ["__app.saveFile()", "save current file"],
  ["__app.getProjectRoot()", "current project root path (or null)"],
  ["__app.getCurrentDocument()", "current doc {path, name, dirty} (or null)"],
  ["__app.isDirty()", "whether any open document has unsaved changes"],
  ["__app.ready", "resolves after the app debug bridge is connected"],
  ["__editor.ready", "resolves after the product-neutral editor bridge is connected"],
  ["__editor.focus()", "focus the active editor surface"],
  ["__editor.getDoc()", "current document text"],
  ["__editor.setDoc(text)", "replace current document text through the active editor"],
  ["__editor.peekDoc()", "current document text without forcing editor focus"],
  ["__editor.getSelection()", "current active editor selection"],
  ["__editor.peekSelection()", "current editor selection without forcing editor focus"],
  ["__editor.insertText(text)", "insert text through the active editor"],
  ["__editor.setSelection(a, f)", "set active editor selection"],
  ["__editor.formatSelection(detail)", "format current selection through the active editor"],
  ["__cfDebug.ready", "resolves after performance/debug helpers are connected"],
  ["__cfDebug.perfSummary()", "current frontend performance span summary"],
  ["__cfDebug.printPerfSummary()", "print frontend performance summary to the console"],
  ["__cfDebug.clearPerf()", "clear frontend performance spans"],
  ["__cfDebug.toggleFps()", "toggle the status-bar FPS meter"],
  ["__cfDebug.togglePerfPanel()", "toggle the floating perf debug panel"],
  ["__cfDebug.scrollGuards()", "recent scroll guard events"],
  ["__cfDebug.clearScrollGuards()", "clear recent scroll guard events"],
  ["__cfDebug.watcherStatus()", "latest frontend native watcher health status"],
  ["__cfDebug.runtimeContract()", "computed editor runtime contract snapshot with drift issues"],
  ["__cfDebug.recorderStatus()", "debug recorder queue/connectivity/capture-mode snapshot"],
  ["__cfDebug.captureState(\"label\")", "combined selection/render/raw-fence/structure snapshot + recorder event"],
  ["__cfDebug.exportSession()", "export locally recorded debug session events"],
  ["__cfDebug.clearSession()", "clear locally recorded debug session events"],
  ["__cfDebug.captureFullSession()", "combined debug export with session events, perf, and current capture"],
  ["__cfDebug.clearAllDebugBuffers()", "clear session events and frontend/backend perf spans"],
  ["__tauriSmoke.openProject(\"/abs/path\")", "dev-only Tauri helper to switch project roots deterministically"],
  ["__tauriSmoke.openFile(\"/abs/path\")", "dev-only Tauri helper to open a file"],
  ["__tauriSmoke.requestNativeClose()", "dev-only Tauri helper to request native close handling"],
  ["__tauriSmoke.listWindows()", "dev-only Tauri helper to list app windows"],
  ["__tauriSmoke.getWindowState()", "dev-only Tauri snapshot: project root, current doc, dirty, backend root, watcher health"],
  ["__tauriSmoke.simulateExternalChange(\"notes.md\")", "dev-only Tauri helper to emit a file-changed event"],
  ["__fencedDivDebug = true", "toggle fenced div parser tracing"],
];

export function formatDebugBridgeDocs(entries = DEBUG_BRIDGE_DOC_ENTRIES) {
  const width = entries.reduce((max, [name]) => Math.max(max, name.length), 0);
  return entries
    .map(([name, description]) => `${name.padEnd(width)} — ${description}`)
    .join("\n");
}
