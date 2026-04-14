import { formatBibEntry } from "../../citations/bibliography";
import type { BibStore } from "../../citations/bibtex-parser";
import type { CslProcessor } from "../../citations/csl-processor";
import type { RenderIndex } from "./reference-index";

export const BRACKETED_REFERENCE_RE = /\[(?:[^\]\n\\]|\\.)*?@[^\]\n]*\]/g;
export const NARRATIVE_REFERENCE_RE = /(^|[^\w])@([A-Za-z0-9_](?:[\w.:-]*\w)?)/g;

export interface RenderCitations {
  readonly cslProcessor?: CslProcessor;
  readonly store: BibStore;
}

export interface ParsedReferenceToken {
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

function formatReferenceItem(id: string, renderIndex: RenderIndex, bracketed: boolean): string {
  const entry = renderIndex.references.get(id);
  if (!entry) {
    return id;
  }
  if (entry.kind === "equation") {
    return bracketed ? (entry.shortLabel ?? entry.label) : entry.label;
  }
  return entry.label;
}

function normalizeCitationLocators(
  locators: readonly (string | undefined)[],
): (string | undefined)[] | undefined {
  return locators.some((locator) => locator != null) ? [...locators] : undefined;
}

function stripCitationWrapper(rendered: string): string {
  const trimmed = rendered.trim();
  if (
    (trimmed.startsWith("(") && trimmed.endsWith(")"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function formatCitationPart(
  id: string,
  citations: RenderCitations | undefined,
  narrative: boolean,
  locator?: string,
): string {
  if (!citations?.store.has(id)) {
    return id;
  }

  if (!citations.cslProcessor) {
    if (narrative) {
      return id;
    }
    return `[${id}]`;
  }

  if (narrative) {
    return citations.cslProcessor.citeNarrative(id);
  }

  const rendered = citations.cslProcessor.cite([id], locator ? [locator] : undefined);
  return stripCitationWrapper(rendered);
}

export function parseReferenceToken(raw: string): ParsedReferenceToken | null {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const body = raw.slice(1, -1);
    const ids: string[] = [];
    const locators: Array<string | undefined> = [];

    for (const match of body.matchAll(/@([A-Za-z0-9_](?:[\w.:-]*\w)?)/g)) {
      const id = match[1];
      ids.push(id);
      const nextFrom = (match.index ?? 0) + match[0].length;
      const remainder = body.slice(nextFrom);
      const nextMatch = remainder.search(/@([A-Za-z0-9_](?:[\w.:-]*\w)?)/);
      const locatorRaw = nextMatch >= 0 ? remainder.slice(0, nextMatch) : remainder;
      const locator = locatorRaw.replace(/^[\s;,:-]+|[\s;,:-]+$/g, "").trim() || undefined;
      locators.push(locator);
    }

    return ids.length > 0
      ? { bracketed: true, ids, locators }
      : null;
  }

  const match = raw.match(/@([A-Za-z0-9_](?:[\w.:-]*\w)?)/);
  if (!match) {
    return null;
  }
  return {
    bracketed: false,
    ids: [match[1]],
    locators: [undefined],
  };
}

function renderBracketedReferenceDisplay(
  parsed: ParsedReferenceToken,
  renderIndex: RenderIndex,
  citations?: RenderCitations,
): string {
  const ids = [...parsed.ids];
  if (ids.length === 0) {
    return "";
  }

  const allCitations = ids.every((id) => citations?.store.has(id));
  if (allCitations && citations?.cslProcessor) {
    return citations.cslProcessor.cite(ids, normalizeCitationLocators(parsed.locators));
  }

  const rendered = ids.map((id, index) =>
    citations?.store.has(id)
      ? formatCitationPart(id, citations, false, parsed.locators[index])
      : formatReferenceItem(id, renderIndex, true));
  const hasOnlyLocalReferences = ids.every((id) => renderIndex.references.has(id));
  if (hasOnlyLocalReferences) {
    return rendered.join("; ");
  }
  const hasOnlyEquations = ids.every((id) => renderIndex.references.get(id)?.kind === "equation");
  if (hasOnlyEquations && rendered.length === 1) {
    return rendered[0];
  }
  return `[${rendered.join("; ")}]`;
}

export function renderReferenceDisplay(
  raw: string,
  renderIndex: RenderIndex,
  citations?: RenderCitations,
): string {
  const parsed = parseReferenceToken(raw);
  if (!parsed) {
    return raw;
  }

  if (parsed.bracketed) {
    return renderBracketedReferenceDisplay(parsed, renderIndex, citations);
  }

  const [id] = parsed.ids;
  if (citations?.store.has(id)) {
    return formatCitationPart(id, citations, true);
  }
  return formatReferenceItem(id, renderIndex, false);
}

export function formatCitationPreview(id: string, citations?: RenderCitations): string | null {
  const entry = citations?.store.get(id);
  if (!entry) {
    return null;
  }
  return formatBibEntry(entry);
}
