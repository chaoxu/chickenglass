import {
  analyzeDocumentSemantics,
  stringTextSource,
} from "../../semantics/document";
import { rememberDocumentAnalysis } from "../../semantics/incremental/cached-document-analysis";
import {
  collectCitationBacklinkIndexFromReferences,
  collectCitationMatches,
  registerCitationsWithProcessor,
} from "../../citations/csl-processor";
import { renderNode } from "./blocks";
import { hasLocalCrossrefTarget, renderBibliography } from "./references";
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
  const semantics = rememberDocumentAnalysis(
    content,
    analyzeDocumentSemantics(stringTextSource(content), tree),
    options?.documentPath,
  );
  const includeBibliography = options?.includeBibliography !== false;
  const cslProcessor = options?.cslProcessor;

  if (options?.bibliography && cslProcessor) {
    const matches = collectCitationMatches(semantics.references, options.bibliography, {
      isLocalTarget: (id) => hasLocalCrossrefTarget(id, semantics, options.blockCounters),
    });
    registerCitationsWithProcessor(matches, cslProcessor);
  }

  const citationBacklinkIndex = options?.bibliography
    ? collectCitationBacklinkIndexFromReferences(semantics.references, options.bibliography, {
        isLocalTarget: (id) => hasLocalCrossrefTarget(id, semantics, options.blockCounters),
      })
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
  if (includeBibliography && context.bibliography && context.citedIds.length > 0) {
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
