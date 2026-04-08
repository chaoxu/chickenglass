/**
 * Render-core barrel: low-level utilities consumed by editor/, plugins/, and citations/.
 *
 * High-level render plugins (which may import from editor/ or plugins/) stay in
 * the main render barrel (index.ts).
 *
 * ORDERING NOTE: fenced-block-core MUST precede math-macros.  math-macros
 * triggers a transitive import chain (frontmatter-state → document-surfaces →
 * bibliography → reference-render → crossref-resolver → plugins →
 * plugin-render) that cycles back to this barrel.  fenced-block-core must be
 * fully loaded first so createFencedBlockDecorationField is available when
 * plugin-render.ts evaluates its module-level call.
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
  createSimpleViewPlugin,
  type CursorSensitiveCollectFn,
} from "./view-plugin-factories";

// ── decoration-field.ts ──────────────────────────────────────────────────────
export {
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

// ── math-macros.ts ───────────────────────────────────────────────────────────
export { getMathMacros, mathMacrosField } from "./math-macros";

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
