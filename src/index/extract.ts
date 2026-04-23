/**
 * Extraction functions that parse markdown content using the shared
 * document analysis layer instead of bespoke tree walks.
 */

import {
  type DocumentSemantics,
  type FencedDivSemantics,
} from "../semantics/document";
import type { DocumentArtifacts } from "../semantics/incremental/engine";
import {
  getDocumentAnalysisSnapshot,
  rememberDocumentAnalysisSnapshot,
} from "../semantics/incremental/cached-document-analysis";
import {
  buildDocumentReferenceCatalog,
  type DocumentReferenceCatalog,
} from "../semantics/reference-catalog";
import type { FileIndex, IndexEntry, IndexReference } from "./query-api";

const fileIndexAnalysisCache = new WeakMap<FileIndex, DocumentSemantics>();

export type FileIndexAnalysisInput = DocumentSemantics | DocumentArtifacts;

export function extractFileIndex(
  content: string,
  file: string,
  analysis?: FileIndexAnalysisInput,
): FileIndex {
  const resolvedAnalysis = resolveAnalysis(content, file, analysis);
  const entries: IndexEntry[] = [];
  const references: IndexReference[] = [];

  extractFromAnalysis(content, file, resolvedAnalysis, entries, references);
  const fileIndex = { file, sourceText: content, entries, references };
  fileIndexAnalysisCache.set(fileIndex, resolvedAnalysis);
  return fileIndex;
}

function resolveAnalysis(
  content: string,
  file: string,
  analysis: FileIndexAnalysisInput | undefined,
): DocumentSemantics {
  if (!analysis) {
    return getDocumentAnalysisSnapshot(content, file);
  }

  const documentAnalysis = isDocumentArtifacts(analysis)
    ? analysis.analysisSnapshot
    : analysis;
  return rememberDocumentAnalysisSnapshot(content, documentAnalysis, file);
}

function isDocumentArtifacts(
  input: FileIndexAnalysisInput,
): input is DocumentArtifacts {
  return "analysis" in input && "ir" in input;
}

export function getFileIndexAnalysis(
  fileIndex: FileIndex,
): DocumentSemantics | undefined {
  return fileIndexAnalysisCache.get(fileIndex);
}

function extractFromAnalysis(
  content: string,
  file: string,
  analysis: DocumentSemantics,
  entries: IndexEntry[],
  references: IndexReference[],
): void {
  const catalog = buildDocumentReferenceCatalog(analysis);
  appendBlockEntries(content, file, analysis, catalog, entries);
  appendEquationEntries(file, catalog, entries);
  appendHeadingEntries(file, catalog, entries);
  appendReferences(file, catalog, references);
}

function appendBlockEntries(
  content: string,
  file: string,
  analysis: DocumentSemantics,
  catalog: DocumentReferenceCatalog,
  entries: IndexEntry[],
): void {
  for (const target of catalog.targets) {
    if (target.kind !== "block") continue;
    const div = analysis.fencedDivByFrom.get(target.from);
    if (!div) continue;

    entries.push({
      type: target.blockType ?? "div",
      label: target.id,
      title: target.title,
      file,
      position: { from: target.from, to: target.to },
      content: extractFencedDivBody(div, content),
    });
  }
}

function appendEquationEntries(
  file: string,
  catalog: DocumentReferenceCatalog,
  entries: IndexEntry[],
): void {
  for (const target of catalog.targets) {
    if (target.kind !== "equation") continue;
    entries.push({
      type: "equation",
      label: target.id,
      file,
      position: { from: target.from, to: target.to },
      content: target.text ?? "",
    });
  }
}

function appendHeadingEntries(
  file: string,
  catalog: DocumentReferenceCatalog,
  entries: IndexEntry[],
): void {
  for (const target of catalog.targets) {
    if (target.kind !== "heading") continue;
    entries.push({
      type: "heading",
      label: target.id,
      number: target.number,
      title: target.title,
      file,
      position: { from: target.from, to: target.to },
      content: target.title ?? "",
    });
  }
}

function appendReferences(
  file: string,
  catalog: DocumentReferenceCatalog,
  references: IndexReference[],
): void {
  for (const ref of catalog.references) {
    references.push({
      bracketed: ref.bracketed,
      ids: ref.ids,
      locators: ref.locators,
      sourceFile: file,
      position: { from: ref.from, to: ref.to },
    });
  }
}

function extractFencedDivBody(div: FencedDivSemantics, content: string): string {
  const bodyStart = skipFenceLine(content, div.openFenceTo);
  const bodyEnd = trimClosingFence(content, div.closeFenceFrom, div.to);
  if (bodyEnd <= bodyStart) return "";
  return content.slice(bodyStart, bodyEnd);
}

function skipFenceLine(content: string, pos: number): number {
  let next = pos;
  while (next < content.length && content[next] !== "\n") next++;
  if (next < content.length && content[next] === "\n") next++;
  return next;
}

function trimClosingFence(content: string, closeFenceFrom: number, fallbackTo: number): number {
  if (closeFenceFrom < 0) return fallbackTo;
  let end = closeFenceFrom;
  if (end > 0 && content[end - 1] === "\n") end--;
  return end;
}

export function updateFileInIndex(
  existingFiles: ReadonlyMap<string, FileIndex>,
  file: string,
  content: string,
  analysis?: FileIndexAnalysisInput,
): Map<string, FileIndex> {
  const newFiles = new Map(existingFiles);
  const fileIndex = extractFileIndex(content, file, analysis);
  newFiles.set(file, fileIndex);
  return newFiles;
}

export function removeFileFromIndex(
  existingFiles: ReadonlyMap<string, FileIndex>,
  file: string,
): Map<string, FileIndex> {
  const newFiles = new Map(existingFiles);
  newFiles.delete(file);
  return newFiles;
}
