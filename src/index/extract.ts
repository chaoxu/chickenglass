/**
 * Pure extraction functions that parse markdown content and extract
 * index entries and references. These functions are used by both
 * the web worker and tests (no worker dependency).
 */

import type { IndexEntry, IndexReference, FileIndex } from "./query-api";

/** Regex to match fenced div opening: ::: {.class #id ...} Optional Title */
const FENCED_DIV_OPEN =
  /^(:{3,})\s+\{([^}]+)\}\s*(.*?)\s*$/;

/** Regex to match equation label: $$ ... $$ {#eq:...} */
const EQUATION_LABEL = /\$\$[\s\S]*?\$\$\s*\{#([^}]+)\}/g;

/** Regex to match reference syntax: [@label] */
const REFERENCE = /\[@([^\]]+)\]/g;

/** Regex to match ATX headings: # ... {#label} */
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+\{#([^}]+)\})?\s*$/;

/**
 * Parse a fenced div attribute string to extract classes and id.
 * Simplified version for indexing (does not need full key-value parsing).
 */
function parseAttrs(attrStr: string): { classes: string[]; id?: string } {
  const classes: string[] = [];
  let id: string | undefined;
  const parts = attrStr.trim().split(/\s+/);

  for (const part of parts) {
    if (part.startsWith(".")) {
      classes.push(part.slice(1));
    } else if (part.startsWith("#")) {
      id = part.slice(1);
    }
  }

  return { classes, id };
}

/**
 * Extract index entries and references from a single markdown file.
 *
 * This performs a line-based scan (not a full Lezer parse) for performance.
 * It captures:
 * - Fenced div blocks with their type, label, title, and content
 * - Equation labels from $$ ... $$ {#eq:...}
 * - Headings with optional labels
 * - Cross-references ([@label])
 */
export function extractFileIndex(
  content: string,
  file: string,
): FileIndex {
  const entries: IndexEntry[] = [];
  const references: IndexReference[] = [];
  const lines = content.split("\n");

  extractFencedDivs(lines, content, file, entries);
  extractEquationLabels(content, file, entries);
  extractHeadings(lines, file, entries);
  extractReferences(content, file, references);

  return { file, entries, references };
}

/**
 * Extract fenced div blocks from lines.
 */
function extractFencedDivs(
  lines: readonly string[],
  content: string,
  file: string,
  entries: IndexEntry[],
): void {
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = FENCED_DIV_OPEN.exec(line);

    if (match) {
      const colonCount = match[1].length;
      const attrStr = match[2];
      const title = match[3] || undefined;
      const { classes, id } = parseAttrs(attrStr);
      const type = classes[0] ?? "div";
      const from = offset;

      // Find closing fence
      const bodyLines: string[] = [];
      let j = i + 1;
      let bodyOffset = offset + line.length + 1;
      let to = offset + line.length;

      while (j < lines.length) {
        const closeLine = lines[j];
        const trimmed = closeLine.trim();
        if (countLeadingColons(trimmed) >= colonCount && /^:{3,}\s*$/.test(trimmed)) {
          to = bodyOffset + closeLine.length;
          break;
        }
        bodyLines.push(closeLine);
        bodyOffset += closeLine.length + 1;
        j++;
      }

      // If we didn't find closing fence, to stays at end of opening line
      if (j >= lines.length) {
        to = content.length;
      }

      const bodyContent = bodyLines.join("\n");

      entries.push({
        type,
        label: id,
        title: title || undefined,
        file,
        position: { from, to },
        content: bodyContent,
      });
    }

    offset += line.length + 1;
  }
}

/** Count leading colon characters in a string. */
function countLeadingColons(s: string): number {
  let count = 0;
  while (count < s.length && s[count] === ":") count++;
  return count;
}

/**
 * Extract equation labels from display math blocks.
 */
function extractEquationLabels(
  content: string,
  file: string,
  entries: IndexEntry[],
): void {
  const regex = new RegExp(EQUATION_LABEL.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const label = match[1];
    const from = match.index;
    const to = from + match[0].length;

    // Extract the math content between $$ markers
    const fullMatch = match[0];
    const dollarStart = fullMatch.indexOf("$$") + 2;
    const dollarEnd = fullMatch.lastIndexOf("$$");
    const mathContent =
      dollarEnd > dollarStart
        ? fullMatch.slice(dollarStart, dollarEnd).trim()
        : "";

    entries.push({
      type: "equation",
      label,
      file,
      position: { from, to },
      content: mathContent,
    });
  }
}

/**
 * Extract headings with optional labels.
 */
function extractHeadings(
  lines: readonly string[],
  file: string,
  entries: IndexEntry[],
): void {
  let offset = 0;

  for (const line of lines) {
    const match = HEADING.exec(line);

    if (match) {
      const level = match[1].length;
      const headingText = match[2];
      const label = match[3];
      const from = offset;
      const to = offset + line.length;

      entries.push({
        type: "heading",
        label,
        number: level,
        title: headingText,
        file,
        position: { from, to },
        content: headingText,
      });
    }

    offset += line.length + 1;
  }
}

/**
 * Extract cross-references from content.
 */
function extractReferences(
  content: string,
  file: string,
  references: IndexReference[],
): void {
  const regex = new RegExp(REFERENCE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    references.push({
      label: match[1],
      sourceFile: file,
      position: { from: match.index, to: match.index + match[0].length },
    });
  }
}

/**
 * Compute incremental update: re-index a single file and merge into existing index.
 * Returns a new files map with the updated file index.
 */
export function updateFileInIndex(
  existingFiles: ReadonlyMap<string, FileIndex>,
  file: string,
  content: string,
): Map<string, FileIndex> {
  const newFiles = new Map(existingFiles);
  const fileIndex = extractFileIndex(content, file);
  newFiles.set(file, fileIndex);
  return newFiles;
}

/**
 * Remove a file from the index.
 */
export function removeFileFromIndex(
  existingFiles: ReadonlyMap<string, FileIndex>,
  file: string,
): Map<string, FileIndex> {
  const newFiles = new Map(existingFiles);
  newFiles.delete(file);
  return newFiles;
}
