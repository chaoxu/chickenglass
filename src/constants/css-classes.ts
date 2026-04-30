import { DOCUMENT_SURFACE_CLASS } from "../document-surface-classes";

/**
 * Typed constants for all cf-* CSS class names used in decorations.
 *
 * Central registry so class names are never hardcoded as bare strings
 * in decoration code. Downstream files import from here instead of
 * duplicating string literals.
 */

/** CSS class name builders and constants for block decorations. */
export const CSS = {
  /** Block wrapper: "cf-block cf-block-{type}" */
  block: (type: string) => `${DOCUMENT_SURFACE_CLASS.block} cf-block cf-block-${type}`,

  /** Always-on stable-shell debug outline for the active block/frontmatter. */
  activeShell: "cf-active-shell",
  activeShellTop: "cf-active-shell-top",
  activeShellBottom: "cf-active-shell-bottom",
  activeShellWidget: "cf-active-shell-widget",
  activeShellFooter: "cf-active-shell-footer",

  /** Block header line (rendered mode). */
  blockHeader: "cf-block-header",

  /** Block source line (editing mode — cursor on fence). */
  blockSource: "cf-block-source",

  /** Rendered block header widget (label text). */
  blockHeaderRendered: "cf-block-header-rendered",

  /** Title paren widgets around user-supplied title text. */
  blockTitleParen: "cf-block-title-paren",

  /** Attribute-only title widget (title from key-value attrs, not inline text). */
  blockAttrTitle: "cf-block-attr-title",

  /** Collapsed header line — no visible label, zero height (e.g. blockquote). */
  blockHeaderCollapsed: "cf-block-header-collapsed",

  /** Closing fence line — always hidden in rich mode (zero height). */
  blockClosingFence: "cf-block-closing-fence",

  /** QED tombstone marker on last content line of proof blocks. */
  blockQed: "cf-block-qed",

  /** Fenced div nesting guide by depth (1-based). */
  fenceDepth: (depth: number) => `cf-fence-d${depth}`,

  /** Source mode editor attribute. */
  sourceMode: "cf-source-mode",

  /** Image wrapper, image element, loading, and error state. */
  imageWrapper: "cf-image-wrapper",
  image: "cf-image",
  imageLoading: "cf-image-loading",
  imagePlaceholder: "cf-image-placeholder",
  imageError: "cf-image-error",

  /** Heading fold toggle. */
  foldToggle: "cf-fold-toggle",
  foldToggleFolded: "cf-fold-toggle-folded",
  foldLine: "cf-fold-line",

  /** Heading line decoration: "cf-heading-line-{level}". */
  headingLine: (level: number) => `cf-heading-line-${level}`,

  /** Inline math wrapper. */
  mathInline: "cf-math-inline",

  /** Display math wrapper. */
  mathDisplay: "cf-math-display",
  mathDisplayNumbered: "cf-math-display-numbered",
  mathDisplayContent: "cf-math-display-content",
  mathDisplayNumber: "cf-math-display-number",

  /** Code block decorations. */
  codeblockHeader: "cf-codeblock-header",
  codeblockBody: "cf-codeblock-body",
  codeblockLast: "cf-codeblock-last",
  codeblockLanguage: "cf-codeblock-language",
  codeblockCopy: "cf-codeblock-copy",
  codeblockHovered: "cf-codeblock-hovered",

  /** Table widget. */
  tableWidget: "cf-table-widget",
  tableCellEditing: "cf-table-cell-editing",
  tableCellActive: "cf-table-cell-active",

  /** Sidenote margin. */
  sidenoteRef: "cf-sidenote-ref",
  sidenoteDefLine: "cf-sidenote-def-line",
  sidenoteDefBody: "cf-sidenote-def-body",
  sidenoteDefLabel: "cf-sidenote-def-label",

  /** Bibliography (References section only). Footnotes use `footnoteSection`
   * below; the two used to share `cf-bibliography` which made it impossible
   * for parity diagnostics or styling rules to target one without the other. */
  bibliography: "cf-bibliography",
  /** Footnotes section root. Replaces the old `cf-bibliography cf-bibliography-footnotes`
   * pair so the section's class no longer overlaps with the references block. */
  footnoteSection: "cf-footnote-section",
  bibliographyHeading: "cf-bibliography-heading",
  bibliographyList: "cf-bibliography-list",
  bibliographyEntry: "cf-bibliography-entry",
  bibliographyEntryNumber: "cf-bibliography-entry-number",
  bibliographyBacklinks: "cf-bibliography-backlinks",
  bibliographyBacklink: "cf-bibliography-backlink",

  /** Cross-reference. */
  crossref: "cf-crossref",

  /** Citation. */
  citation: "cf-citation",
  citationPreview: "cf-citation-preview",

  /** Shared preview surfaces. */
  previewSurfaceShell: "cf-preview-surface-shell",
  previewSurfaceContent: "cf-preview-surface-content",
  previewSurfaceHeader: "cf-preview-surface-header",
  previewSurfaceBody: "cf-preview-surface-body",

  /** Hover preview. */
  hoverPreview: "cf-hover-preview",
  hoverPreviewBody: "cf-hover-preview-body",
  hoverPreviewHeader: "cf-hover-preview-header",
  hoverPreviewUnresolved: "cf-hover-preview-unresolved",
  hoverPreviewCitation: "cf-hover-preview-citation",
  hoverPreviewSeparator: "cf-hover-preview-separator",

  /** Reference autocomplete. */
  referenceCompletionTooltip: "cf-reference-completion-tooltip",
  referenceCompletionPreview: "cf-reference-completion-preview",
  referenceCompletionCitation: "cf-reference-completion-citation",
  referenceCompletionContent: "cf-reference-completion-content",
  referenceCompletionCrossref: "cf-reference-completion-crossref",
  referenceCompletionMeta: "cf-reference-completion-meta",

  /** Document title from frontmatter. */
  docTitle: "cf-doc-title",

  sectionNumber: "cf-section-number",

  /** Block blockquote. */
  blockBlockquote: "cf-block-blockquote",

  /** Hidden elements (markers, URLs, etc. collapsed when cursor is away). */
  hidden: "cf-hidden",

  /** Heading mark decorations (font-weight, text styling): "cf-heading-{level}". */
  heading: (level: number) => `cf-heading-${level}`,

  /** Horizontal rule. */
  hr: "cf-hr",

  /** Inline formatting marks. */
  highlight: "cf-highlight",
  bold: "cf-bold",
  italic: "cf-italic",
  strikethrough: "cf-strikethrough",
  inlineCode: "cf-inline-code",

  /** List marker decorations. */
  listBullet: "cf-list-bullet",
  listNumber: "cf-list-number",

  /** Rendered link. */
  linkRendered: "cf-link-rendered",

  /** Math error (KaTeX rendering failure). */
  mathError: "cf-math-error",

  /** Source delimiter (revealed **, *, ~~, ==, $, \(, etc. — reduced metrics). */
  sourceDelimiter: "cf-source-delimiter",

  /** Generic inline source content revealed inside an existing prose line. */
  inlineSource: "cf-inline-source",

  /** Math source (delimiter visible when cursor on math). */
  mathSource: "cf-math-source",

  /** Reference source (raw token visible when cursor on cross-ref/citation). */
  referenceSource: "cf-reference-source",

  /** Code block source fences (visible when cursor on either fence). */
  codeblockSource: "cf-codeblock-source",
  codeblockSourceOpen: "cf-codeblock-source cf-codeblock-source-open",
  codeblockSourceClose: "cf-codeblock-source cf-codeblock-source-close",

  /** Crossref unresolved state. */
  crossrefUnresolved: "cf-crossref cf-crossref-unresolved",

  /** Citation narrative variant. */
  citationNarrative: "cf-citation cf-citation-narrative",

  /** Focus mode dimmed line. */
  focusDimmed: "cf-focus-dimmed",

  /** Math preview panel. */
  mathPreviewScroller: "cf-math-preview-scroller",
  mathPreviewLayer: "cf-math-preview-layer",
  mathPreview: "cf-math-preview",
  mathPreviewContent: "cf-math-preview-content",

  /** Search/replace panel. */
  searchPanel: "cf-search-panel",
  searchRow: "cf-search-row",
  searchReplaceRow: "cf-replace-row",
  searchInput: "cf-search-input",
  searchInputWrap: "cf-search-input-wrap",
  searchMatchInfo: "cf-search-match-info",
  searchToggle: "cf-search-toggle",
  searchToggleActive: "cf-search-toggle-active",
  searchToggles: "cf-search-toggles",
  searchAction: "cf-search-action",
  searchNav: "cf-search-nav",
  searchClose: "cf-search-close",
  searchReplaceActions: "cf-search-replace-actions",
  searchToggleReplace: "cf-search-toggle-replace",
  searchMatch: "cf-search-match",
  searchMatchSelected: "cf-search-match-selected",

  /** Heading fold level: "cf-fold-h{level}". */
  foldHeading: (level: number) => `cf-fold-h${level}`,

  /** Sidenote body rendered in margin. */
  sidenoteBodyRendered: "cf-sidenote-body-rendered",
  sidenoteScroller: "cf-sidenote-scroller",
  sidenotePortal: "cf-sidenote-portal",
  sidenoteEntry: "cf-sidenote-entry",
  sidenoteEntryNumber: "cf-sidenote-entry-number",

  /** Inline footnote expansion (#458). */
  sidenoteRefExpanded: "cf-sidenote-ref-expanded",
  footnoteInline: "cf-footnote-inline",
  footnoteInlineHeader: "cf-footnote-inline-header",
  footnoteInlineNumber: "cf-footnote-inline-number",
  footnoteInlineEdit: "cf-footnote-inline-edit",
  footnoteInlineBody: "cf-footnote-inline-body",

  /** Hover preview tooltip container. */
  hoverPreviewTooltip: "cf-hover-preview-tooltip",

  /** Breadcrumb overlay. */
  breadcrumbs: "cf-breadcrumbs",
  breadcrumbsVisible: "cf-breadcrumbs-visible",
  breadcrumbsHidden: "cf-breadcrumbs-hidden",
  breadcrumbsInstant: "cf-breadcrumbs-instant",

  /** Lightweight nested inline editor. */
  inlineEditor: "cf-inline-editor",
} as const;
