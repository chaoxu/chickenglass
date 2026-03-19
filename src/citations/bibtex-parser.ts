/**
 * BibTeX parser adapter using @retorquere/bibtex-parser.
 *
 * Normalizes the library's rich output into the flat BibEntry interface
 * used throughout the application.
 */

import { parse, type Entry, type Creator } from "@retorquere/bibtex-parser";

/** A single parsed BibTeX entry. */
export interface BibEntry {
  /** Citation key, e.g. "karger2000". */
  id: string;
  /** Entry type, e.g. "article", "book", "inproceedings". */
  type: string;
  author?: string;
  title?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  publisher?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  url?: string;
  [field: string]: string | undefined;
}

/**
 * Format a Creator array back into a BibTeX-style author string.
 * Produces "Last, First and Last, First" format.
 */
function formatCreators(creators: Creator[]): string {
  return creators
    .map((c) => {
      if (c.name) return c.name;
      const parts: string[] = [];
      if (c.prefix) parts.push(c.prefix);
      if (c.lastName) parts.push(c.lastName);
      if (c.firstName) {
        return `${parts.join(" ")}, ${c.firstName}`;
      }
      return parts.join(" ");
    })
    .join(" and ");
}

/** Fields where the library returns Creator[] instead of string. */
const CREATOR_FIELDS = new Set([
  "author", "bookauthor", "collaborator", "commentator", "director",
  "editor", "editora", "editorb", "editors", "holder",
  "scriptwriter", "translator",
]);

/** Fields where the library returns string[] instead of string. */
const ARRAY_FIELDS = new Set([
  "keywords", "institution", "publisher", "origpublisher",
  "organization", "location", "origlocation",
]);

/**
 * Convert a library Entry into our flat BibEntry interface.
 */
function toBibEntry(entry: Entry): BibEntry {
  const result: BibEntry = {
    id: entry.key,
    type: entry.type.toLowerCase(),
  };

  for (const [key, value] of Object.entries(entry.fields)) {
    if (value === undefined || value === null) continue;

    if (CREATOR_FIELDS.has(key) && Array.isArray(value)) {
      result[key] = formatCreators(value as Creator[]);
    } else if (ARRAY_FIELDS.has(key) && Array.isArray(value)) {
      result[key] = (value as string[]).join(" and ");
    } else if (typeof value === "string") {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Parse BibTeX content into an array of structured entries.
 *
 * @param content - The full text content of a .bib file
 * @returns Array of parsed BibEntry objects
 */
export function parseBibTeX(content: string): BibEntry[] {
  if (!content.trim()) return [];

  try {
    const library = parse(content, {
      english: false,
      raw: true,
    });
    return library.entries.map(toBibEntry);
  } catch {
    // Malformed BibTeX content — return empty list rather than crashing
    return [];
  }
}

/**
 * Parse a BibTeX author string into structured name objects.
 * Handles "Last, First and Last, First" and "First Last" formats.
 *
 * Shared by CSL conversion (which needs full {family, given} pairs)
 * and extractLastName (which only needs the first author's family name).
 */
export function parseAuthorNames(
  authorStr: string,
): Array<{ family: string; given: string }> {
  return authorStr.split(/\s+and\s+/i).map((name) => {
    const trimmed = name.trim();
    if (trimmed.includes(",")) {
      const [family, given] = trimmed.split(",", 2);
      return { family: family.trim(), given: (given ?? "").trim() };
    }
    // "First Middle Last" -> given="First Middle", family="Last"
    const parts = trimmed.split(/\s+/);
    const family = parts.pop() ?? trimmed;
    return { family, given: parts.join(" ") };
  });
}

/**
 * Extract the last name from a BibTeX author string.
 * Handles "Last, First" and "First Last" formats.
 * For multiple authors, returns the first author's last name.
 */
export function extractLastName(author: string): string {
  return parseAuthorNames(author)[0]?.family ?? author;
}
