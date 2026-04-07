import type { CslJsonItem } from "../../citations/bibtex-parser";
import {
  buildCitationBacklinkAriaLabel,
  buildCitationBacklinkContextFromText,
  COMPACT_CITATION_BACKLINK_TEXT,
} from "../../citations/bibliography-backlinks";
import { formatBibEntry, sortBibEntries } from "../../citations/bibliography";
import type { BibStore } from "../../citations/citation-render";
import type { CitationBacklink } from "../../citations/csl-processor";
import { sanitizeCslHtml } from "../../render/inline-shared";
import { CSS } from "../../constants/css-classes";
import {
  type BlockCounterEntry,
  type CitationRenderContext,
  escapeHtml,
} from "./shared";

export function resolveCrossrefLabel(
  id: string,
  semantics?: CitationRenderContext["semantics"],
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>,
): string {
  if (blockCounters) {
    const block = blockCounters.get(id);
    if (block) return `${block.title} ${block.number}`;
  }
  if (!semantics) return id;

  const equation = semantics.equationById.get(id);
  if (equation) return `Eq. (${equation.number})`;

  for (const heading of semantics.headings) {
    if (heading.id === id) {
      return heading.number ? `Section ${heading.number}` : heading.text;
    }
  }

  return id;
}

function trackCitedIds(
  ids: readonly string[],
  bibliography?: BibStore,
  citedIds?: string[],
): void {
  if (!bibliography || !citedIds) return;
  for (const id of ids) {
    if (bibliography.has(id) && !citedIds.includes(id)) {
      citedIds.push(id);
    }
  }
}

function nextCitationAnchorId(
  ids: readonly string[],
  bibliography: BibStore | undefined,
  nextCitationOccurrence: { value: number } | undefined,
): string | undefined {
  if (!bibliography || !nextCitationOccurrence) return undefined;
  if (!ids.some((id) => bibliography.has(id))) return undefined;
  nextCitationOccurrence.value += 1;
  return `cite-ref-${nextCitationOccurrence.value}`;
}

export function renderCitationCluster(
  ids: readonly string[],
  locators: readonly (string | undefined)[] | undefined,
  citationContext: CitationRenderContext,
): string {
  const {
    bibliography,
    citedIds,
    cslProcessor,
    blockCounters,
    semantics,
    nextCitationOccurrence,
  } = citationContext;
  const knownCount = bibliography
    ? ids.filter((id) => bibliography.has(id)).length
    : 0;

  if (knownCount === 0) {
    const parts = ids.map((id) => {
      const label = resolveCrossrefLabel(id, semantics, blockCounters);
      return `<a class="cross-ref" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`;
    });
    return ids.length === 1 ? parts[0] : parts.join("; ");
  }

  trackCitedIds(ids, bibliography, citedIds);
  const anchorId = nextCitationAnchorId(ids, bibliography, nextCitationOccurrence);
  const anchorAttr = anchorId ? ` id="${anchorId}"` : "";

  if (bibliography && knownCount === ids.length && cslProcessor) {
    const normalizedLocators =
      locators && locators.some((locator) => locator != null) ? locators : undefined;
    const rendered = normalizedLocators
      ? cslProcessor.cite([...ids], [...normalizedLocators])
      : cslProcessor.cite([...ids]);
    return `<span${anchorAttr} class="${CSS.citation}">${escapeHtml(rendered)}</span>`;
  }

  const parts = ids.map((id, index) => {
    if (bibliography?.has(id) && cslProcessor) {
      const rendered = cslProcessor.cite(
        [id],
        locators ? [locators[index]] : undefined,
      );
      const stripped = rendered.startsWith("(") && rendered.endsWith(")")
        ? rendered.slice(1, -1)
        : rendered;
      return escapeHtml(stripped);
    }

    const label = resolveCrossrefLabel(id, semantics, blockCounters);
    return `<a class="cross-ref" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`;
  });
  return `<span${anchorAttr} class="${CSS.citation}">(${parts.join("; ")})</span>`;
}

export function renderNarrativeReference(
  id: string,
  citationContext: CitationRenderContext,
): string {
  const {
    bibliography,
    citedIds,
    cslProcessor,
    nextCitationOccurrence,
  } = citationContext;
  if (bibliography?.has(id)) {
    trackCitedIds([id], bibliography, citedIds);
    const anchorId = nextCitationAnchorId([id], bibliography, nextCitationOccurrence);
    const anchorAttr = anchorId ? ` id="${anchorId}"` : "";
    if (cslProcessor) {
      return `<span${anchorAttr} class="${CSS.citation} ${CSS.citation}-narrative">${escapeHtml(cslProcessor.citeNarrative(id))}</span>`;
    }
    return `<span${anchorAttr} class="${CSS.citation} ${CSS.citation}-narrative">${escapeHtml(id)}</span>`;
  }

  return `<a class="cross-ref" href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`;
}

export function renderBibliography(
  bibliography: BibStore,
  citedIds: string[],
  cslProcessor?: CitationRenderContext["cslProcessor"],
  citationBacklinks?: ReadonlyMap<string, readonly CitationBacklink[]>,
  sourceText?: string,
): string {
  let cslHtml: string[] = [];
  if (cslProcessor) {
    cslHtml = cslProcessor.bibliography(citedIds);
  }

  const unsortedEntries = citedIds
    .map((id) => bibliography.get(id))
    .filter((entry): entry is CslJsonItem => entry !== undefined);
  const entries = cslHtml.length > 0 ? unsortedEntries : sortBibEntries(unsortedEntries);

  if (entries.length === 0) return "";

  const items = cslHtml.length > 0
    ? entries.map((entry, index) =>
        `<div class="${CSS.bibliographyEntry}" id="bib-${escapeHtml(entry.id)}">${sanitizeCslHtml(cslHtml[index] ?? "")}${renderBibliographyBacklinks(entry.id, citationBacklinks, sourceText)}</div>`)
    : entries.map((entry) =>
        `<div class="${CSS.bibliographyEntry}" id="bib-${escapeHtml(entry.id)}">${escapeHtml(formatBibEntry(entry))}${renderBibliographyBacklinks(entry.id, citationBacklinks, sourceText)}</div>`);

  return [
    "",
    `<section class="${CSS.bibliography}">`,
    `<h2 class="${CSS.bibliographyHeading}">References</h2>`,
    `<div class="${CSS.bibliographyList}">`,
    items.join("\n"),
    "</div>",
    "</section>",
  ].join("\n");
}

function renderBibliographyBacklinks(
  id: string,
  citationBacklinks?: ReadonlyMap<string, readonly CitationBacklink[]>,
  sourceText?: string,
): string {
  const backlinks = citationBacklinks?.get(id);
  if (!backlinks || backlinks.length === 0) return "";

  const links = backlinks.map((backlink) => {
    const context = sourceText
      ? buildCitationBacklinkContextFromText(sourceText, backlink)
      : "";
    const titleAttr = context.length > 0 ? ` title="${escapeHtml(context)}"` : "";
    const ariaLabel = context.length > 0
      ? buildCitationBacklinkAriaLabel(context)
      : "Jump to citation";
    return `<a class="${CSS.bibliographyBacklink}" href="#cite-ref-${backlink.occurrence}" aria-label="${escapeHtml(ariaLabel)}"${titleAttr}>${COMPACT_CITATION_BACKLINK_TEXT}</a>`;
  }).join(" ");
  return ` <span class="${CSS.bibliographyBacklinks}">${links}</span>`;
}
