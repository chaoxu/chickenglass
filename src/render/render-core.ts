/**
 * Render-core barrel: low-level utilities consumed by editor/, plugins/, and citations/.
 *
 * This barrel re-exports ONLY modules with no imports from src/editor/ or
 * src/plugins/ (math-macros.ts imports editor/frontmatter-state but does not
 * create a cycle because frontmatter-state only imports render-utils directly).
 *
 * High-level render plugins (which may import from editor/ or plugins/) stay in
 * the main render barrel (index.ts).
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
  type RenderableNode,
  type SimpleTextRenderSpec,
} from "./render-utils";

// ── inline-shared.ts ─────────────────────────────────────────────────────────
export { MARK_NODES, isSafeUrl, buildKatexOptions, sanitizeCslHtml } from "./inline-shared";

// ── math-macros.ts ───────────────────────────────────────────────────────────
export { getMathMacros, mathMacrosField } from "./math-macros";

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
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
} from "./fenced-block-core";

// ── math-render.ts (type exports) ────────────────────────────────────────────
export type { MathWidget } from "./math-render";

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
