/**
 * Render-core barrel: low-level utilities consumed by editor/, plugins/, and citations/.
 *
 * High-level render plugins (which may import from editor/ or plugins/) stay in
 * the main render barrel (index.ts).
 */

// ── node-collection.ts ───────────────────────────────────────────────────────
export {
  cursorInRange,
  collectNodes,
  collectNodeRangesExcludingCursor,
  type RenderableNode,
} from "./node-collection";

// ── widget-core.ts ───────────────────────────────────────────────────────────
export {
  BaseRenderWidget,
  cloneRenderedHTMLElement,
  makeTextElement,
  createSimpleTextWidget,
} from "./widget-core";

// ── source-widget.ts ─────────────────────────────────────────────────────────
export {
  serializeMacros,
  widgetSourceMap,
  resolveLiveWidgetSourceRange,
  RenderWidget,
  SimpleTextRenderWidget,
  MacroAwareWidget,
  type SimpleTextRenderSpec,
} from "./source-widget";

// ── reference-widget.ts ──────────────────────────────────────────────────────
export {
  REFERENCE_WIDGET_SELECTOR,
  findReferenceWidgetContainer,
  isReferenceWidgetTarget,
  ReferenceWidget,
  SimpleTextReferenceWidget,
  type ReferenceRootSpec,
  type ReferenceItemSpec,
  type ReferenceListSpec,
  type SimpleTextReferenceSpec,
} from "./reference-widget";

// ── shell-widget.ts ──────────────────────────────────────────────────────────
export {
  ShellWidget,
  ShellMacroAwareWidget,
} from "./shell-widget";

// ── decoration-core.ts ───────────────────────────────────────────────────────
export {
  buildDecorations,
  decorationHidden,
  addMarkerReplacement,
  pushWidgetDecoration,
} from "./decoration-core";

// ── focus-state.ts ───────────────────────────────────────────────────────────
export {
  createBooleanToggleField,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./focus-state";

// ── scroll-anchor.ts ─────────────────────────────────────────────────────────
export {
  captureScrollAnchor,
  restoreScrollAnchor,
  requestScrollStabilizedMeasure,
  mutateWithScrollStabilizedMeasure,
} from "./scroll-anchor";

// ── viewport-diff.ts ─────────────────────────────────────────────────────────
export {
  diffVisibleRanges,
  isPositionInRanges,
  mapVisibleRanges,
  mergeRanges,
  normalizeDirtyRange,
  rangeIntersectsRanges,
  snapshotRanges,
  type VisibleRange,
} from "./viewport-diff";

// ── view-plugin-factories.ts ─────────────────────────────────────────────────
export {
  defaultShouldUpdate,
  cursorSensitiveShouldUpdate,
  createCursorSensitiveViewPlugin,
  createSemanticSensitiveViewPlugin,
  createSimpleViewPlugin,
  type CursorSensitiveCollectFn,
} from "./view-plugin-factories";

// ── decoration-field.ts ──────────────────────────────────────────────────────
export {
  createDecorationStateField,
  createDecorationsField,
  defaultShouldRebuild,
  cursorSensitiveShouldRebuild,
} from "./decoration-field";

// ── inline-shared.ts ─────────────────────────────────────────────────────────
export { MARK_NODES, isSafeUrl, buildKatexOptions, sanitizeCslHtml } from "./inline-shared";

// ── fenced-block-core.ts (all exports) ───────────────────────────────────────
export {
  type FencedBlockInfo,
  type FencedBlockRenderContext,
  isCursorOnOpenFence,
  isCursorOnCloseFence,
  getFencedBlockRenderContext,
  findFencedBlockAt,
  getLineElement,
  addSingleLineClosingFence,
  addCollapsedClosingFence,
  hideMultiLineClosingFence,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
} from "./fenced-block-core";

// ── math-widget.ts (type exports) ────────────────────────────────────────────
export type { MathWidget } from "./math-widget";

// ── table-utils.ts (type exports) ────────────────────────────────────────────
export {
  type Alignment,
  type TableCell,
  type TableRow,
  type ParsedTable,
  type TableParseResult,
} from "./table-utils";

// ── crossref-render.ts (type exports) ────────────────────────────────────────
export type {
  CrossrefWidget,
  ClusteredCrossrefWidget,
  MixedClusterPart,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
