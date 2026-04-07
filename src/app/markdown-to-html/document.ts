import {
  analyzeDocumentSemantics,
  stringTextSource,
} from "../../semantics/document";
import {
  CslProcessor,
  collectCitationBacklinkIndexFromReferences,
  collectCitationMatches,
  registerCitationsWithProcessor,
} from "../../citations/csl-processor";
import { renderNode } from "./blocks";
import { renderBibliography } from "./references";
import {
  mdParser,
  type MarkdownToHtmlOptions,
  type WalkContext,
} from "./shared";

export function markdownToHtml(
  content: string,
  options?: MarkdownToHtmlOptions,
): string {
  const tree = mdParser.parse(content);
  const semantics = analyzeDocumentSemantics(stringTextSource(content), tree);
  const cslProcessor = options?.cslProcessor ?? (options?.bibliography
    ? new CslProcessor([...options.bibliography.values()])
    : undefined);

  if (options?.bibliography && cslProcessor) {
    const matches = collectCitationMatches(semantics.references, options.bibliography);
    registerCitationsWithProcessor(matches, cslProcessor);
  }

  const citationBacklinkIndex = options?.bibliography
    ? collectCitationBacklinkIndexFromReferences(semantics.references, options.bibliography)
    : undefined;

  const context: WalkContext = {
    doc: content,
    macros: options?.macros,
    sectionNumbers: options?.sectionNumbers ?? false,
    semantics,
    bibliography: options?.bibliography,
    cslProcessor,
    blockCounters: options?.blockCounters,
    surface: "document-body",
    citedIds: [],
    citationBacklinks: citationBacklinkIndex?.backlinks ?? new Map(),
    nextCitationOccurrence: { value: 0 },
    documentPath: options?.documentPath,
    imageUrlOverrides: options?.imageUrlOverrides,
  };

  let html = renderNode(tree.topNode, context);
  if (context.bibliography && context.citedIds.length > 0) {
    html += renderBibliography(
      context.bibliography,
      context.citedIds,
      context.cslProcessor,
      context.citationBacklinks,
      context.doc,
    );
  }
  return html;
}
