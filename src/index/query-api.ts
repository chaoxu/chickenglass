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
  /** Maximum number of results to return. */
  readonly limit?: number;
}

/** A raw-text search against source files. */
export interface SourceTextQuery {
  /** Raw source text to match, case-insensitively. */
  readonly text: string;
  /** Restrict results to a specific file path. */
  readonly file?: string;
  /** Maximum number of results to return. */
  readonly limit?: number;
}

/** A single entry in the document index. */
export interface IndexEntry {
  /** Block type: "theorem", "definition", "equation", "heading", etc. */
  readonly type: string;
  /** Label (id) if present, e.g., "thm-1" or "eq:foo". */
  readonly label?: string;
  /** Rendered number string matching the canonical semantic model (e.g., "1.2.3" for headings, "2" for blocks). */
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
  readonly revision?: number;
  readonly files: ReadonlyMap<string, FileIndex>;
}

/** Result of resolving a label across indexed files. */
export type LabelResolution =
  | {
      readonly kind: "missing";
      readonly targets: readonly [];
    }
  | {
      readonly kind: "unique";
      readonly target: IndexEntry;
      readonly targets: readonly [IndexEntry];
    }
  | {
      readonly kind: "ambiguous";
      readonly targets: readonly [IndexEntry, IndexEntry, ...IndexEntry[]];
    };

/** Result of resolving a cross-file reference. */
export interface ResolvedReference {
  /** The reference itself. */
  readonly reference: IndexReference;
  /** The specific label this result was queried for. */
  readonly label: string;
  /** Explicit zero/one/many target resolution for this reference label. */
  readonly resolution: LabelResolution;
  /** All target entries for this reference label, sorted stably. */
  readonly targets: readonly IndexEntry[];
  /** The target entry when resolution is unique; undefined when missing or ambiguous. */
  readonly target: IndexEntry | undefined;
}

interface SourceLineIndex {
  readonly lineNumber: number;
  readonly offset: number;
  readonly text: string;
  readonly lowerText: string;
}

const entryContentLowerCache = new WeakMap<IndexEntry, string>();
const sourceLineIndexCache = new WeakMap<FileIndex, readonly SourceLineIndex[]>();
const documentQueryCache = new WeakMap<DocumentIndex, DocumentIndexQueryCache>();

interface DocumentIndexQueryCache {
  readonly revision: number | undefined;
  readonly files: ReadonlyMap<string, FileIndex>;
  readonly allEntries: readonly IndexEntry[];
  readonly entriesByType: ReadonlyMap<string, readonly IndexEntry[]>;
  readonly entriesByLabel: ReadonlyMap<string, readonly IndexEntry[]>;
  readonly sortedTargetsByLabel: ReadonlyMap<string, readonly IndexEntry[]>;
}

function normalizeResultLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  return Math.max(0, Math.floor(limit));
}

function hasReachedLimit(results: readonly IndexEntry[], limit: number | undefined): boolean {
  return limit !== undefined && results.length >= limit;
}

function getLowerEntryContent(entry: IndexEntry): string {
  const cached = entryContentLowerCache.get(entry);
  if (cached !== undefined) return cached;
  const lowerContent = entry.content.toLowerCase();
  entryContentLowerCache.set(entry, lowerContent);
  return lowerContent;
}

function getSourceLineIndex(fileIndex: FileIndex): readonly SourceLineIndex[] {
  const cached = sourceLineIndexCache.get(fileIndex);
  if (cached !== undefined) return cached;

  const lines = fileIndex.sourceText.split("\n");
  const indexedLines: SourceLineIndex[] = [];
  let offset = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const text = lines[lineNumber];
    indexedLines.push({
      lineNumber: lineNumber + 1,
      offset,
      text,
      lowerText: text.toLowerCase(),
    });
    offset += text.length + 1;
  }

  sourceLineIndexCache.set(fileIndex, indexedLines);
  return indexedLines;
}

function compareIndexEntries(left: IndexEntry, right: IndexEntry): number {
  const fileCompare = compareStrings(left.file, right.file);
  if (fileCompare !== 0) return fileCompare;
  if (left.position.from !== right.position.from) {
    return left.position.from - right.position.from;
  }
  if (left.position.to !== right.position.to) {
    return left.position.to - right.position.to;
  }
  const typeCompare = compareStrings(left.type, right.type);
  if (typeCompare !== 0) return typeCompare;
  return compareStrings(left.label ?? "", right.label ?? "");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function getOrCreateDocumentQueryCache(index: DocumentIndex): DocumentIndexQueryCache {
  const cached = documentQueryCache.get(index);
  if (
    cached !== undefined
    && cached.revision === index.revision
    && cached.files === index.files
  ) {
    return cached;
  }

  const allEntries: IndexEntry[] = [];
  const entriesByType = new Map<string, IndexEntry[]>();
  const entriesByLabel = new Map<string, IndexEntry[]>();

  for (const [, fileIndex] of index.files) {
    for (const entry of fileIndex.entries) {
      allEntries.push(entry);

      const typedEntries = entriesByType.get(entry.type);
      if (typedEntries) {
        typedEntries.push(entry);
      } else {
        entriesByType.set(entry.type, [entry]);
      }

      if (entry.label !== undefined) {
        const labelledEntries = entriesByLabel.get(entry.label);
        if (labelledEntries) {
          labelledEntries.push(entry);
        } else {
          entriesByLabel.set(entry.label, [entry]);
        }
      }
    }
  }

  const sortedTargetsByLabel = new Map<string, readonly IndexEntry[]>();
  for (const [label, entries] of entriesByLabel) {
    sortedTargetsByLabel.set(label, [...entries].sort(compareIndexEntries));
  }

  const nextCache: DocumentIndexQueryCache = {
    revision: index.revision,
    files: index.files,
    allEntries,
    entriesByType,
    entriesByLabel,
    sortedTargetsByLabel,
  };
  documentQueryCache.set(index, nextCache);
  return nextCache;
}

function queryCandidateEntries(
  index: DocumentIndex,
  query: IndexQuery,
): readonly IndexEntry[] {
  if (query.file !== undefined) {
    const entries = index.files.get(query.file)?.entries ?? [];
    if (query.type === undefined && query.label === undefined) {
      return entries;
    }
    if (query.type !== undefined && query.label === undefined) {
      return entries.filter((entry) => entry.type === query.type);
    }
    if (query.label !== undefined && query.type === undefined) {
      return entries.filter((entry) => entry.label === query.label);
    }
    return entries.filter((entry) =>
      entry.type === query.type && entry.label === query.label);
  }

  const cache = getOrCreateDocumentQueryCache(index);
  if (query.type !== undefined && query.label === undefined) {
    return cache.entriesByType.get(query.type) ?? [];
  }
  if (query.label !== undefined && query.type === undefined) {
    return cache.entriesByLabel.get(query.label) ?? [];
  }
  if (query.type !== undefined && query.label !== undefined) {
    const typedEntries = cache.entriesByType.get(query.type) ?? [];
    return typedEntries.filter((entry) => entry.label === query.label);
  }
  return cache.allEntries;
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
  const limit = normalizeResultLimit(query.limit);
  if (limit === 0) return results;

  const content = query.content?.toLowerCase();
  const candidates = queryCandidateEntries(index, query);

  for (const entry of candidates) {
    if (
      content !== undefined &&
      !getLowerEntryContent(entry).includes(content)
    ) {
      continue;
    }
    results.push(entry);
    if (hasReachedLimit(results, limit)) return results;
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
  const limit = normalizeResultLimit(query.limit);
  if (limit === 0) return results;

  for (const [, fileIndex] of index.files) {
    if (query.file !== undefined && fileIndex.file !== query.file) continue;

    for (const line of getSourceLineIndex(fileIndex)) {
      let searchFrom = 0;

      while (true) {
        const found = line.lowerText.indexOf(needle, searchFrom);
        if (found < 0) break;

        results.push({
          type: "text",
          number: String(line.lineNumber),
          file: fileIndex.file,
          position: {
            from: line.offset + found,
            to: line.offset + found + text.length,
          },
          content: line.text,
        });
        if (hasReachedLimit(results, limit)) return results;

        searchFrom = found + Math.max(text.length, 1);
      }
    }
  }

  return results;
}

/**
 * Collect all defined labels across indexed files in file/entry iteration order.
 */
export function getAllLabels(index: DocumentIndex): readonly string[] {
  const labels: string[] = [];

  for (const [, fileIndex] of index.files) {
    for (const entry of fileIndex.entries) {
      if (entry.label !== undefined) {
        labels.push(entry.label);
      }
    }
  }

  return labels;
}

/**
 * Resolve a label to all matching target entries across all files.
 * Results are sorted by file path and source position so reporting is stable
 * regardless of Map insertion order.
 */
export function resolveLabelTargets(
  index: DocumentIndex,
  label: string,
): readonly IndexEntry[] {
  return getOrCreateDocumentQueryCache(index).sortedTargetsByLabel.get(label) ?? [];
}

/**
 * Resolve a label to a missing/unique/ambiguous result across all files.
 */
export function resolveLabelResolution(
  index: DocumentIndex,
  label: string,
): LabelResolution {
  const targets = resolveLabelTargets(index, label);
  if (targets.length === 0) {
    return { kind: "missing", targets: [] };
  }
  if (targets.length === 1) {
    return { kind: "unique", target: targets[0], targets: [targets[0]] };
  }
  return { kind: "ambiguous", targets: targets as [IndexEntry, IndexEntry, ...IndexEntry[]] };
}

/**
 * Resolve a label to its unique target entry across all files.
 * Returns undefined when the label is missing or ambiguous.
 */
export function resolveLabel(
  index: DocumentIndex,
  label: string,
): IndexEntry | undefined {
  const resolution = resolveLabelResolution(index, label);
  return resolution.kind === "unique" ? resolution.target : undefined;
}

/**
 * Find all references to a given label across all files.
 */
export function findReferences(
  index: DocumentIndex,
  label: string,
): readonly ResolvedReference[] {
  const resolution = resolveLabelResolution(index, label);
  const target = resolution.kind === "unique" ? resolution.target : undefined;
  const results: ResolvedReference[] = [];

  for (const [, fileIndex] of index.files) {
    for (const ref of fileIndex.references) {
      if (ref.ids.includes(label)) {
        results.push({
          reference: ref,
          label,
          resolution,
          targets: resolution.targets,
          target,
        });
      }
    }
  }

  return results;
}
