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
  block: (type: string) => `cf-block cf-block-${type}`,

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

  /** Include fence lines — collapsed to zero height. */
  includeFence: "cf-include-fence",

  /** Fenced div nesting guide by depth (1-based). */
  fenceDepth: (depth: number) => `cf-fence-d${depth}`,

  /** Source mode editor attribute. */
  sourceMode: "cf-source-mode",

  /** Read mode editor attribute. */
  readMode: "cf-read-mode",

  /** Embed container: "cf-embed cf-embed-{type}". */
  embed: (type: string) => `cf-embed cf-embed-${type}`,

  /** Embed iframe element. */
  embedIframe: "cf-embed-iframe",

  /** YouTube-specific iframe class. */
  embedYoutubeIframe: "cf-embed-iframe cf-embed-youtube-iframe",

  /** Image wrapper, image element, and error state. */
  imageWrapper: "cf-image-wrapper",
  image: "cf-image",
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

  /** Include region and label. */
  includeRegion: "cf-include-region",
  includeLabel: "cf-include-label",
  includeLabelActive: "cf-include-label-active",

  /** Sidenote margin. */
  sidenoteRef: "cf-sidenote-ref",
  sidenoteDefLine: "cf-sidenote-def-line",
  sidenoteDefBody: "cf-sidenote-def-body",
  sidenoteDefLabel: "cf-sidenote-def-label",

  /** Bibliography. */
  bibliography: "cf-bibliography",
  bibliographyHeading: "cf-bibliography-heading",
  bibliographyList: "cf-bibliography-list",
  bibliographyEntry: "cf-bibliography-entry",

  /** Cross-reference. */
  crossref: "cf-crossref",

  /** Citation. */
  citation: "cf-citation",

  /** Hover preview. */
  hoverPreview: "cf-hover-preview",
  hoverPreviewBody: "cf-hover-preview-body",
  hoverPreviewHeader: "cf-hover-preview-header",
  hoverPreviewUnresolved: "cf-hover-preview-unresolved",
  hoverPreviewCitation: "cf-hover-preview-citation",
  hoverPreviewSeparator: "cf-hover-preview-separator",

  /** Document title from frontmatter. */
  docTitle: "cf-doc-title",

  /** Read mode view container. */
  readModeView: "cf-read-mode-view",
  readTitle: "cf-read-title",
  sectionNumber: "cf-section-number",

  /** Block blockquote. */
  blockBlockquote: "cf-block-blockquote",

  /** Block include. */
  blockInclude: "cf-block-include",

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
  sidenotePortal: "cf-sidenote-portal",
  sidenoteEntry: "cf-sidenote-entry",
  sidenoteEntryNumber: "cf-sidenote-entry-number",

  /** Hover preview tooltip container. */
  hoverPreviewTooltip: "cf-hover-preview-tooltip",
} as const;
