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
 * Extract the last name from a BibTeX author string.
 * Handles "Last, First" and "First Last" formats.
 * For multiple authors, returns the first author's last name.
 */
export function extractLastName(author: string): string {
  // Split on " and " to handle multiple authors
  const firstAuthor = author.split(/\s+and\s+/i)[0].trim();

  // "Last, First" format
  if (firstAuthor.includes(",")) {
    return firstAuthor.split(",")[0].trim();
  }

  // "First Last" format -- take the last word
  const parts = firstAuthor.split(/\s+/);
  return parts[parts.length - 1];
}
