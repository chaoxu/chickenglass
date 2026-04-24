/**
 * Shared document-surface class names used by both CM6 rich rendering and
 * Lexical WYSIWYG rendering. Editor-specific classes can still exist, but
 * these classes are the cross-editor visual contract.
 */

export const DOCUMENT_SURFACE_CLASS = {
  surface: "cf-doc-surface",
  surfaceCm6: "cf-doc-surface--cm6",
  surfaceLexical: "cf-doc-surface--lexical",
  flow: "cf-doc-flow",
  flowCm6: "cf-doc-flow--cm6",
  flowLexical: "cf-doc-flow--lexical",
  paragraph: "cf-doc-paragraph",
  blockquote: "cf-doc-blockquote",
  heading: "cf-doc-heading",
  headingLevel: (level: number) => `cf-doc-heading--h${level}`,
  list: "cf-doc-list",
  listOrdered: "cf-doc-list--ordered",
  listUnordered: "cf-doc-list--unordered",
  listCheck: "cf-doc-list--check",
  listItem: "cf-doc-list-item",
  link: "cf-doc-link",
  codeBlock: "cf-doc-code-block",
  codeToken: "cf-doc-code-token",
  displayMath: "cf-doc-display-math",
  block: "cf-doc-block",
  blockHeader: "cf-doc-block-header",
  blockLabel: "cf-doc-block-label",
  blockTitle: "cf-doc-block-title",
  blockBody: "cf-doc-block-body",
  blockCaption: "cf-doc-block-caption",
  tableBlock: "cf-doc-table-block",
} as const;

export function documentSurfaceClassNames(
  ...classNames: Array<string | false | null | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
