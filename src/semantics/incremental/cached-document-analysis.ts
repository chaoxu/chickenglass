import { ChangeSet } from "@codemirror/state";
import { type DocumentAnalysis, stringTextSource } from "../document";
import { markdownSemanticsParser } from "../markdown-parser";
import { coalesceChangedRanges } from "./dirty-windows";
import {
  buildDocumentArtifacts,
  createDocumentAnalysis,
  createDocumentArtifacts,
  type DocumentArtifacts,
  updateDocumentAnalysis,
  updateDocumentArtifacts,
} from "./engine";
import type { RawChangedRange, SemanticDelta } from "./types";

export interface CachedDocumentAnalysis {
  readonly version: number;
  readonly text: string;
  readonly analysis: DocumentAnalysis;
}

export interface CachedDocumentArtifacts {
  readonly version: number;
  readonly text: string;
  readonly artifacts: DocumentArtifacts;
}

const MAX_SHARED_DOCUMENT_ANALYSIS_ENTRIES = 64;
const sharedDocumentAnalysisCache = new Map<string, CachedDocumentAnalysis>();
const sharedDocumentArtifactsCache = new Map<string, CachedDocumentArtifacts>();

export function getCachedDocumentAnalysis(
  text: string,
  previous?: CachedDocumentAnalysis,
): CachedDocumentAnalysis {
  if (previous?.text === text) {
    return previous;
  }

  const doc = stringTextSource(text);
  const tree = markdownSemanticsParser.parse(text);
  if (!previous) {
    return {
      version: 0,
      text,
      analysis: createDocumentAnalysis(doc, tree),
    };
  }

  return {
    version: previous.version + 1,
    text,
    analysis: updateDocumentAnalysis(
      previous.analysis,
      doc,
      tree,
      buildTextSemanticDelta(previous.text, text),
    ),
  };
}

export function rememberCachedDocumentAnalysis(
  text: string,
  analysis: DocumentAnalysis,
  previous?: CachedDocumentAnalysis,
): CachedDocumentAnalysis {
  if (previous?.text === text && previous.analysis === analysis) {
    return previous;
  }

  return {
    version:
      previous && previous.text !== text
        ? previous.version + 1
        : previous?.version ?? 0,
    text,
    analysis,
  };
}

export function getCachedDocumentArtifacts(
  text: string,
  previous?: CachedDocumentArtifacts,
): CachedDocumentArtifacts {
  if (previous?.text === text) {
    return previous;
  }

  const doc = stringTextSource(text);
  const tree = markdownSemanticsParser.parse(text);
  if (!previous) {
    return {
      version: 0,
      text,
      artifacts: createDocumentArtifacts(doc, tree),
    };
  }

  return {
    version: previous.version + 1,
    text,
    artifacts: updateDocumentArtifacts(
      previous.artifacts,
      doc,
      tree,
      buildTextSemanticDelta(previous.text, text),
    ),
  };
}

function getCachedDocumentArtifactsFromAnalysis(
  text: string,
  previous?: CachedDocumentAnalysis,
): CachedDocumentArtifacts {
  const doc = stringTextSource(text);
  const tree = markdownSemanticsParser.parse(text);

  if (!previous) {
    return {
      version: 0,
      text,
      artifacts: createDocumentArtifacts(doc, tree),
    };
  }

  if (previous.text === text) {
    return {
      version: previous.version,
      text,
      artifacts: buildDocumentArtifacts(previous.analysis, doc, tree),
    };
  }

  const analysis = updateDocumentAnalysis(
    previous.analysis,
    doc,
    tree,
    buildTextSemanticDelta(previous.text, text),
  );
  return {
    version: previous.version + 1,
    text,
    artifacts: buildDocumentArtifacts(analysis, doc, tree),
  };
}

/**
 * Shared non-CM6 accessor for callers that know a stable document path.
 * The underlying analysis still comes from the incremental engine; this
 * wrapper only owns cross-caller cache lookup/adoption.
 */
export function getDocumentAnalysis(
  text: string,
  cacheKey?: string,
): DocumentAnalysis {
  const normalizedCacheKey = normalizeCacheKey(cacheKey);
  if (!normalizedCacheKey) {
    return getCachedDocumentAnalysis(text).analysis;
  }

  const cached = getCachedDocumentAnalysis(
    text,
    getSharedCachedDocumentAnalysis(normalizedCacheKey),
  );
  setSharedCachedDocumentAnalysis(normalizedCacheKey, cached);
  invalidateSharedDocumentArtifacts(normalizedCacheKey, cached);
  return cached.analysis;
}

/**
 * Shared non-CM6 accessor for callers that need both semantic analysis and
 * `DocumentIR`. This keeps IR consumers on the same cached incremental
 * analysis source as the indexer and citation paths while rebuilding the IR
 * projection from the current text/tree.
 */
export function getDocumentArtifacts(
  text: string,
  cacheKey?: string,
): DocumentArtifacts {
  const normalizedCacheKey = normalizeCacheKey(cacheKey);
  if (!normalizedCacheKey) {
    return getCachedDocumentArtifacts(text).artifacts;
  }

  const cachedArtifacts = getSharedCachedDocumentArtifacts(normalizedCacheKey);
  const cached = cachedArtifacts
    ? getCachedDocumentArtifacts(text, cachedArtifacts)
    : getCachedDocumentArtifactsFromAnalysis(
        text,
        getSharedCachedDocumentAnalysis(normalizedCacheKey),
      );
  setSharedCachedDocumentArtifacts(normalizedCacheKey, cached);
  return cached.artifacts;
}

export function rememberDocumentAnalysis(
  text: string,
  analysis: DocumentAnalysis,
  cacheKey?: string,
): DocumentAnalysis {
  const normalizedCacheKey = normalizeCacheKey(cacheKey);
  if (!normalizedCacheKey) {
    return analysis;
  }

  const cached = rememberCachedDocumentAnalysis(
    text,
    analysis,
    getSharedCachedDocumentAnalysis(normalizedCacheKey),
  );
  setSharedCachedDocumentAnalysis(normalizedCacheKey, cached);
  invalidateSharedDocumentArtifacts(normalizedCacheKey, cached);
  return cached.analysis;
}

export function clearDocumentAnalysisCache(): void {
  sharedDocumentAnalysisCache.clear();
  sharedDocumentArtifactsCache.clear();
}

function buildTextSemanticDelta(
  previousText: string,
  nextText: string,
): SemanticDelta {
  const rawChangedRanges = collectChangedRanges(previousText, nextText);
  const changes = ChangeSet.of(
    rawChangedRanges.map((range) => ({
      from: range.fromOld,
      to: range.toOld,
      insert: nextText.slice(range.fromNew, range.toNew),
    })),
    previousText.length,
  );

  return {
    rawChangedRanges,
    dirtyWindows: coalesceChangedRanges(rawChangedRanges),
    docChanged: rawChangedRanges.length > 0,
    syntaxTreeChanged: rawChangedRanges.length > 0,
    frontmatterChanged: rawChangedRanges.some((range) =>
      touchesFrontmatter(previousText, range.fromOld, range.toOld)
      || touchesFrontmatter(nextText, range.fromNew, range.toNew),
    ),
    globalInvalidation: false,
    plainInlineTextOnlyChange: false,
    mapOldToNew(pos, assoc = -1) {
      return changes.mapPos(pos, assoc);
    },
    mapNewToOld(pos, assoc = -1) {
      return changes.invertedDesc.mapPos(pos, assoc);
    },
  };
}

function normalizeCacheKey(cacheKey?: string): string | undefined {
  if (!cacheKey || cacheKey.length === 0) {
    return undefined;
  }
  return cacheKey;
}

function getSharedCachedDocumentAnalysis(
  cacheKey: string,
): CachedDocumentAnalysis | undefined {
  const cached = sharedDocumentAnalysisCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }

  // Simple LRU refresh so long-lived sessions do not grow the shared cache
  // without bound.
  sharedDocumentAnalysisCache.delete(cacheKey);
  sharedDocumentAnalysisCache.set(cacheKey, cached);
  return cached;
}

function setSharedCachedDocumentAnalysis(
  cacheKey: string,
  cached: CachedDocumentAnalysis,
): void {
  sharedDocumentAnalysisCache.set(cacheKey, cached);
  if (sharedDocumentAnalysisCache.size <= MAX_SHARED_DOCUMENT_ANALYSIS_ENTRIES) {
    return;
  }

  const oldestCacheKey = sharedDocumentAnalysisCache.keys().next().value;
  if (oldestCacheKey !== undefined) {
    sharedDocumentAnalysisCache.delete(oldestCacheKey);
  }
}

function getSharedCachedDocumentArtifacts(
  cacheKey: string,
): CachedDocumentArtifacts | undefined {
  const cached = sharedDocumentArtifactsCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }

  sharedDocumentArtifactsCache.delete(cacheKey);
  sharedDocumentArtifactsCache.set(cacheKey, cached);
  return cached;
}

function setSharedCachedDocumentArtifacts(
  cacheKey: string,
  cached: CachedDocumentArtifacts,
): void {
  sharedDocumentArtifactsCache.set(cacheKey, cached);
  setSharedCachedDocumentAnalysis(cacheKey, {
    version: cached.version,
    text: cached.text,
    analysis: cached.artifacts.analysis,
  });

  if (sharedDocumentArtifactsCache.size <= MAX_SHARED_DOCUMENT_ANALYSIS_ENTRIES) {
    return;
  }

  const oldestCacheKey = sharedDocumentArtifactsCache.keys().next().value;
  if (oldestCacheKey !== undefined) {
    sharedDocumentArtifactsCache.delete(oldestCacheKey);
  }
}

function invalidateSharedDocumentArtifacts(
  cacheKey: string,
  cached: CachedDocumentAnalysis,
): void {
  const artifacts = sharedDocumentArtifactsCache.get(cacheKey);
  if (
    artifacts?.text === cached.text
    && artifacts.artifacts.analysis === cached.analysis
  ) {
    return;
  }
  sharedDocumentArtifactsCache.delete(cacheKey);
}

function collectChangedRanges(
  previousText: string,
  nextText: string,
): readonly RawChangedRange[] {
  if (previousText === nextText) {
    return [];
  }

  let prefix = 0;
  const maxPrefix = Math.min(previousText.length, nextText.length);
  while (
    prefix < maxPrefix
    && previousText.charCodeAt(prefix) === nextText.charCodeAt(prefix)
  ) {
    prefix++;
  }

  let previousSuffix = previousText.length;
  let nextSuffix = nextText.length;
  while (
    previousSuffix > prefix
    && nextSuffix > prefix
    && previousText.charCodeAt(previousSuffix - 1) === nextText.charCodeAt(nextSuffix - 1)
  ) {
    previousSuffix--;
    nextSuffix--;
  }

  return [{
    fromOld: prefix,
    toOld: previousSuffix,
    fromNew: prefix,
    toNew: nextSuffix,
  }];
}

function touchesFrontmatter(text: string, from: number, to: number): boolean {
  const end = frontmatterEnd(text);
  if (end <= 0) {
    return false;
  }
  if (from === to) {
    return from < end;
  }
  return from < end && to > 0;
}

function frontmatterEnd(text: string): number {
  if (!lineIsFrontmatterDelimiter(text, 0)) {
    return -1;
  }

  let pos = nextLineStart(text, 0);
  if (pos < 0) {
    return -1;
  }

  while (pos <= text.length) {
    if (lineIsFrontmatterDelimiter(text, pos)) {
      const lineEnd = lineEndOffset(text, pos);
      return lineEnd === text.length ? text.length : lineEnd + 1;
    }

    const next = nextLineStart(text, pos);
    if (next < 0) {
      break;
    }
    pos = next;
  }

  return -1;
}

function lineIsFrontmatterDelimiter(text: string, from: number): boolean {
  const end = lineEndOffset(text, from);
  const line = text.slice(from, end);
  return line.startsWith("---") && line.slice(3).trim().length === 0;
}

function lineEndOffset(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
}

function nextLineStart(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end === -1 ? -1 : end + 1;
}
