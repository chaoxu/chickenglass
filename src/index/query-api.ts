/**
 * Query interface for the semantic document index.
 *
 * Provides types for querying indexed blocks, equations, and references
 * across all parsed markdown files.
 */

/** A query against the document index. All fields are optional filters. */
export interface IndexQuery {
  /** Block type filter: "theorem", "definition", "equation", etc. */
  readonly type?: string;
  /** Specific label to look up (e.g., "thm-1", "eq:foo"). */
  readonly label?: string;
  /** Full-text search within block content. */
  readonly content?: string;
  /** Restrict results to a specific file path. */
  readonly file?: string;
}

/** A raw-text search against source files. */
export interface SourceTextQuery {
  /** Raw source text to match, case-insensitively. */
  readonly text: string;
  /** Restrict results to a specific file path. */
  readonly file?: string;
}

/** A single entry in the document index. */
export interface IndexEntry {
  /** Block type: "theorem", "definition", "equation", "heading", etc. */
  readonly type: string;
  /** Label (id) if present, e.g., "thm-1" or "eq:foo". */
  readonly label?: string;
  /** Rendered number string matching the canonical semantic model (e.g., "1.2.3" for headings). */
  readonly number?: string;
  /** Title text if present (from fenced div title). */
  readonly title?: string;
  /** Source file path. */
  readonly file: string;
  /** Character position in the source file. */
  readonly position: { readonly from: number; readonly to: number };
  /** Text content of the block (for search). */
  readonly content: string;
}

/** A cross-file reference found in the index. */
export interface IndexReference {
  /** Whether this is a bracketed reference ([@id]) vs narrative (@id). */
  readonly bracketed: boolean;
  /** All referenced IDs in this cluster (e.g., ["a", "b"] for [@a; @b]). */
  readonly ids: readonly string[];
  /** Locator strings parallel to ids (e.g., "p. 5"), undefined when absent. */
  readonly locators: readonly (string | undefined)[];
  /** The file containing the reference. */
  readonly sourceFile: string;
  /** Position of the reference in the source file. */
  readonly position: { readonly from: number; readonly to: number };
}

/** Per-file index data. */
export interface FileIndex {
  /** File path. */
  readonly file: string;
  /** Full raw source text of the file. */
  readonly sourceText: string;
  /** All indexed entries in this file. */
  readonly entries: readonly IndexEntry[];
  /** All references found in this file. */
  readonly references: readonly IndexReference[];
}

/** Complete index across all files. */
export interface DocumentIndex {
  readonly files: ReadonlyMap<string, FileIndex>;
}

/** Result of resolving a cross-file reference. */
export interface ResolvedReference {
  /** The reference itself. */
  readonly reference: IndexReference;
  /** The target entry, if found. */
  readonly target: IndexEntry | undefined;
}

/**
 * Query the document index, returning all entries matching the given filters.
 * Filters are AND-combined: an entry must match all specified fields.
 */
export function queryIndex(
  index: DocumentIndex,
  query: IndexQuery,
): readonly IndexEntry[] {
  const results: IndexEntry[] = [];

  for (const [, fileIndex] of index.files) {
    if (query.file !== undefined && fileIndex.file !== query.file) continue;

    for (const entry of fileIndex.entries) {
      if (query.type !== undefined && entry.type !== query.type) continue;
      if (query.label !== undefined && entry.label !== query.label) continue;
      if (
        query.content !== undefined &&
        !entry.content.toLowerCase().includes(query.content.toLowerCase())
      ) {
        continue;
      }
      results.push(entry);
    }
  }

  return results;
}

/**
 * Search raw source text line-by-line across indexed files.
 *
 * Returns synthetic `IndexEntry` objects with `type: "text"` and `number`
 * set to the 1-based line number. This keeps the app-search UI and navigation
 * contract uniform across semantic and source-mode search results.
 */
export function querySourceText(
  index: DocumentIndex,
  query: SourceTextQuery,
): readonly IndexEntry[] {
  const text = query.text.trim();
  if (!text) return [];

  const needle = text.toLowerCase();
  const results: IndexEntry[] = [];

  for (const [, fileIndex] of index.files) {
    if (query.file !== undefined && fileIndex.file !== query.file) continue;

    const lines = fileIndex.sourceText.split("\n");
    let offset = 0;

    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
      const lineText = lines[lineNumber];
      const haystack = lineText.toLowerCase();
      let searchFrom = 0;

      while (true) {
        const found = haystack.indexOf(needle, searchFrom);
        if (found < 0) break;

        results.push({
          type: "text",
          number: String(lineNumber + 1),
          file: fileIndex.file,
          position: {
            from: offset + found,
            to: offset + found + text.length,
          },
          content: lineText,
        });

        searchFrom = found + Math.max(text.length, 1);
      }

      offset += lineText.length + 1;
    }
  }

  return results;
}

/**
 * Resolve a label to its target entry across all files.
 * Returns the first matching entry, or undefined if not found.
 */
export function resolveLabel(
  index: DocumentIndex,
  label: string,
): IndexEntry | undefined {
  for (const [, fileIndex] of index.files) {
    for (const entry of fileIndex.entries) {
      if (entry.label === label) return entry;
    }
  }
  return undefined;
}

/**
 * Find all references to a given label across all files.
 */
export function findReferences(
  index: DocumentIndex,
  label: string,
): readonly ResolvedReference[] {
  const target = resolveLabel(index, label);
  const results: ResolvedReference[] = [];

  for (const [, fileIndex] of index.files) {
    for (const ref of fileIndex.references) {
      if (ref.ids.includes(label)) {
        results.push({ reference: ref, target });
      }
    }
  }

  return results;
}
