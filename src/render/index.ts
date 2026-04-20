// ── Re-export everything from render-core (low-level, no editor/plugins deps) ─
export * from "./render-core";

// ── High-level render plugins ────────────────────────────────────────────────
export { renderInlineMarkdown } from "./inline-render";
export { markdownRenderPlugin } from "./markdown-render";
export {
  blockRenderPlugin,
} from "./plugin-render";
export {
  MathWidget,
  mathRenderPlugin,
  renderKatex,
  findActiveMath,
  MATH_TYPES,
  stripMathDelimiters,
  getDisplayMathContentEnd,
} from "./math-render";
export {
  CrossrefWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
export {
  referenceRenderDependenciesChanged,
  planReferenceRendering,
  collectReferenceRanges,
  referenceRenderPlugin,
  type ReferenceRenderItem,
} from "./reference-render";
export {
  ImagePreviewWidget,
  imageRenderPlugin,
} from "./image-render";
export { isPdfTarget } from "../lib/pdf-target";
export {
  pdfPreviewField,
  pdfPreviewEffect,
  pdfPreviewRemoveEffect,
  requestPdfPreview,
  ERROR_COOLDOWN_MS,
  type MediaEntryBase,
  type PdfPreviewEntry,
  type PdfPreviewUpdate,
} from "./pdf-preview-cache";
export {
  containerAttributesField,
  containerAttributesPlugin,
} from "./container-attributes";
export {
  codeBlockRenderPlugin,
  codeBlockStructureField,
  collectCodeBlocks,
  type CodeBlockInfo,
} from "./code-block-render";
export { tableRenderPlugin, insertTable } from "./table-render";
export { debugInspectorPlugin, toggleDebugInspector } from "./debug-inspector";
export { checkboxRenderPlugin } from "./checkbox-render";
export { mathPreviewPlugin } from "./math-preview";
export { sectionNumberPlugin } from "./section-counter";
export { fenceGuidePlugin } from "./fence-guide";
export { focusModeExtension, toggleFocusMode } from "./focus-mode";
export { hoverPreviewExtension } from "./hover-preview";
export {
  sidenoteRenderPlugin,
  collectFootnotes,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
  footnoteInlineToggleEffect,
  footnoteInlineExpandedField,
} from "./sidenote-render";
export { searchHighlightPlugin } from "./search-highlight";
export {
  parseTable,
  formatTable,
  serializeTable,
  detectAlignment,
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
  setAlignment,
  moveRow,
  moveColumn,
} from "./table-utils";
