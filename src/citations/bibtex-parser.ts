/**
 * Simple BibTeX parser that converts .bib file content into structured entries.
 *
 * Handles standard BibTeX entry types (article, book, inproceedings, etc.)
 * with braced or quoted field values, including nested braces.
 */

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
 * Extract the value of a braced field value, handling nested braces.
 * Starts after the opening `{` and returns the content up to the matching `}`.
 */
function extractBracedValue(content: string, start: number): { value: string; end: number } | null {
  let depth = 1;
  let i = start;
  while (i < content.length && depth > 0) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
    if (depth > 0) i++;
  }
  if (depth !== 0) return null;
  return { value: content.slice(start, i), end: i };
}

/**
 * Extract a quoted field value starting after the opening `"`.
 * Handles escaped quotes.
 */
function extractQuotedValue(content: string, start: number): { value: string; end: number } | null {
  let i = start;
  while (i < content.length) {
    if (content[i] === '"' && content[i - 1] !== "\\") {
      return { value: content.slice(start, i), end: i };
    }
    i++;
  }
  return null;
}

/**
 * Parse a single field value (braced, quoted, or bare number).
 * Returns the parsed value and the index after it.
 */
function parseFieldValue(content: string, start: number): { value: string; end: number } | null {
  let i = start;
  // Skip whitespace
  while (i < content.length && /\s/.test(content[i])) i++;

  if (i >= content.length) return null;

  if (content[i] === "{") {
    return extractBracedValue(content, i + 1);
  }
  if (content[i] === '"') {
    return extractQuotedValue(content, i + 1);
  }
  // Bare value (number or month abbreviation)
  const match = /^([a-zA-Z0-9]+)/.exec(content.slice(i));
  if (match) {
    return { value: match[1], end: i + match[1].length };
  }
  return null;
}

/**
 * Parse fields from within the braces of a BibTeX entry.
 * Expects content between the outer `{key, ...}` braces.
 */
function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;

  while (i < body.length) {
    // Skip whitespace and commas
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;

    // Find field name
    const nameMatch = /^([a-zA-Z_][a-zA-Z0-9_-]*)/.exec(body.slice(i));
    if (!nameMatch) {
      i++;
      continue;
    }
    const fieldName = nameMatch[1].toLowerCase();
    i += nameMatch[1].length;

    // Skip whitespace
    while (i < body.length && /\s/.test(body[i])) i++;

    // Expect `=`
    if (i >= body.length || body[i] !== "=") continue;
    i++;

    // Parse value
    const result = parseFieldValue(body, i);
    if (!result) continue;

    fields[fieldName] = result.value.trim();
    i = result.end + 1;
  }

  return fields;
}

/**
 * Parse BibTeX content into an array of structured entries.
 *
 * @param content - The full text content of a .bib file
 * @returns Array of parsed BibEntry objects
 */
export function parseBibTeX(content: string): BibEntry[] {
  const entries: BibEntry[] = [];

  // Match @type{key, at the start of each entry
  const entryPattern = /@\s*([a-zA-Z]+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(content)) !== null) {
    const type = match[1].toLowerCase();

    // Skip @comment, @preamble, @string
    if (type === "comment" || type === "preamble" || type === "string") {
      // Skip to the matching closing brace
      const braceResult = extractBracedValue(content, match.index + match[0].length);
      if (braceResult) {
        entryPattern.lastIndex = braceResult.end + 1;
      }
      continue;
    }

    // Find the citation key (everything up to the first comma)
    const afterBrace = match.index + match[0].length;
    const commaIndex = content.indexOf(",", afterBrace);
    if (commaIndex === -1) continue;

    const id = content.slice(afterBrace, commaIndex).trim();
    if (!id) continue;

    // Extract the body of the entry (fields between first comma and closing brace)
    const braceResult = extractBracedValue(content, afterBrace);
    if (!braceResult) continue;

    const body = braceResult.value.slice(commaIndex - afterBrace + 1);
    const fields = parseFields(body);

    const entry: BibEntry = { id, type, ...fields };
    entries.push(entry);

    entryPattern.lastIndex = braceResult.end + 1;
  }

  return entries;
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

  // "First Last" format — take the last word
  const parts = firstAuthor.split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Format a citation label from a BibEntry.
 * Returns "(Author, Year)" format for parenthetical citations.
 */
export function formatCitation(entry: BibEntry): string {
  const author = entry.author ? extractLastName(entry.author) : entry.id;
  const year = entry.year ?? "";
  return `${author}, ${year}`;
}

/**
 * Format a narrative citation from a BibEntry.
 * Returns "Author (Year)" format.
 */
export function formatNarrativeCitation(entry: BibEntry): string {
  const author = entry.author ? extractLastName(entry.author) : entry.id;
  const year = entry.year ?? "";
  return `${author} (${year})`;
}
