import DOMPurify from "dompurify";

import {
  extractFirstFamilyName,
  extractYear,
  formatCslAuthors,
  type BibStore,
  type CslJsonItem,
} from "./bibtex-parser";
import type { CitationBacklink } from "./csl-processor";
import { isSafeUrl } from "../lib/url-utils";
import { containsMarkdownMath } from "../lib/markdown-math";

const SAFE_CSL_ELEMENTS = [
  "a", "abbr", "b", "br", "cite", "code", "div", "em", "i", "mark",
  "p", "q", "s", "small", "span", "strong", "sub", "sup", "u",
] as const;

const SAFE_CSL_ATTRIBUTES = ["class", "id", "href", "title"] as const;
const DANGEROUS_CSL_ELEMENTS = [
  "script", "style", "noscript", "template", "iframe", "object",
  "embed", "form", "input", "textarea", "button", "select",
] as const;

let cslPurifyReady = false;

function ensureCslPurify(): void {
  if (cslPurifyReady) {
    return;
  }

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.hasAttribute("href")) {
      const href = node.getAttribute("href") ?? "";
      if (!isSafeUrl(href)) {
        node.removeAttribute("href");
      }
    }
  });
  cslPurifyReady = true;
}

export function formatBibEntry(entry: CslJsonItem): string {
  const parts: string[] = [];
  const author = formatCslAuthors(entry.author);
  if (author) {
    parts.push(author);
  }

  if (entry.title) {
    parts.push(entry.title);
  }

  const venue = entry["container-title"];
  if (venue) {
    let venuePart = venue;
    if (entry.volume) {
      venuePart += `, ${entry.volume}`;
      if (entry.issue) {
        venuePart += `(${entry.issue})`;
      }
    }
    if (entry.page) {
      venuePart += `, ${entry.page}`;
    }
    parts.push(venuePart);
  }

  const year = extractYear(entry);
  if (year) {
    parts.push(year);
  }

  return `${parts.join(". ")}.`;
}

export function sortBibEntries(entries: readonly CslJsonItem[]): CslJsonItem[] {
  return [...entries].sort((left, right) => {
    const leftName = extractFirstFamilyName(left.author, left.id).toLowerCase();
    const rightName = extractFirstFamilyName(right.author, right.id).toLowerCase();
    if (leftName !== rightName) {
      return leftName < rightName ? -1 : 1;
    }
    const leftYear = extractYear(left) ?? "";
    const rightYear = extractYear(right) ?? "";
    return leftYear.localeCompare(rightYear);
  });
}

export function sanitizeCslHtml(raw: string): string {
  ensureCslPurify();
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [...SAFE_CSL_ELEMENTS],
    ALLOWED_ATTR: [...SAFE_CSL_ATTRIBUTES],
    FORBID_CONTENTS: [...DANGEROUS_CSL_ELEMENTS],
  });
}

export function buildBibliographyEntries(
  store: BibStore,
  citedIds: readonly string[],
  cslHtml: readonly string[],
): Array<{
  readonly id: string;
  readonly plainText: string;
  readonly renderedHtml?: string;
}> {
  const entries = citedIds
    .map((id) => store.get(id))
    .filter((entry): entry is CslJsonItem => entry !== undefined);

  if (cslHtml.length > 0) {
    return entries.map((entry, index) => {
      const plainText = formatBibEntry(entry);
      return {
        id: entry.id,
        plainText,
        renderedHtml: containsMarkdownMath(plainText)
          ? undefined
          : sanitizeCslHtml(cslHtml[index] ?? ""),
      };
    });
  }

  return sortBibEntries(entries).map((entry) => ({
    id: entry.id,
    plainText: formatBibEntry(entry),
  }));
}

export function buildCitationBacklinkMap(
  backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
): Map<string, readonly CitationBacklink[]> {
  return new Map(backlinks);
}
