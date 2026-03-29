// ── Re-export everything from render-core (low-level, no editor/plugins deps) ─
export * from "./render-core";

// ── High-level render plugins ────────────────────────────────────────────────
export { renderInlineMarkdown } from "./inline-render";
export { markdownRenderPlugin } from "./markdown-render";
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
// reference-render re-exports removed — imports from citations/ would create
// a cycle through this barrel.  Import from "./reference-render" directly.
export {
  ImageWidget,
  PdfLoadingWidget,
  imageRenderPlugin,
} from "./image-render";
export { isPdfTarget } from "../lib/pdf-target";
export {
  pdfPreviewField,
  pdfPreviewEffect,
  pdfPreviewRemoveEffect,
  requestPdfPreview,
  ERROR_COOLDOWN_MS,
  type PdfPreviewEntry,
  type PdfPreviewUpdate,
} from "./pdf-preview-cache";
export {
  containerAttributesField,
  containerAttributesPlugin,
} from "./container-attributes";
export {
  codeBlockRenderPlugin,
  collectCodeBlocks,
  type CodeBlockInfo,
} from "./code-block-render";
export { tableRenderPlugin, insertTable } from "./table-render";
export { debugInspectorPlugin, toggleDebugInspector } from "./debug-inspector";
export { checkboxRenderPlugin } from "./checkbox-render";
export { mathPreviewPlugin } from "./math-preview";
export { sectionNumberPlugin } from "./section-counter";
export { fenceGuidePlugin } from "./fence-guide";
export { includeLabelPlugin } from "./include-label";
export { focusModeExtension, toggleFocusMode } from "./focus-mode";
export {
  sidenoteRenderPlugin,
  collectFootnotes,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
  footnoteInlineToggleEffect,
  footnoteInlineExpandedField,
} from "./sidenote-render";
// hover-preview re-export removed — imports from plugins/ and citations/
// would create a cycle through this barrel.  Import from "./hover-preview" directly.
// search-highlight re-export removed — imports from editor/find-replace
// would create a cycle through this barrel.  Import from "./search-highlight" directly.
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
