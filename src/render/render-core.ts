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

// ── render-utils.ts (all exports) ────────────────────────────────────────────
export {
  cursorInRange,
  collectNodes,
  buildDecorations,
  createBooleanToggleField,
  createDecorationsField,
  createSimpleViewPlugin,
  createSimpleTextWidget,
  createCursorSensitiveViewPlugin,
  diffVisibleRanges,
  collectNodeRangesExcludingCursor,
  makeTextElement,
  pushWidgetDecoration,
  serializeMacros,
  decorationHidden,
  addMarkerReplacement,
  RenderWidget,
  SimpleTextRenderWidget,
  MacroAwareWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
  defaultShouldUpdate,
  defaultShouldRebuild,
  cursorSensitiveShouldUpdate,
  cursorSensitiveShouldRebuild,
  type RenderableNode,
  type SimpleTextRenderSpec,
  type VisibleRange,
  type CursorSensitiveCollectFn,
} from "./render-utils";

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
