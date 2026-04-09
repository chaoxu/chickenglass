/**
 * Extraction functions that parse markdown content using the shared
 * document analysis layer instead of bespoke tree walks.
 */

import {
  type DocumentSemantics,
  type FencedDivSemantics,
} from "../semantics/document";
import { getCachedDocumentAnalysis } from "../semantics/incremental/cached-document-analysis";
import {
  buildDocumentReferenceCatalog,
  type DocumentReferenceCatalog,
} from "../semantics/reference-catalog";
import type { FileIndex, IndexEntry, IndexReference } from "./query-api";

export function extractFileIndex(
  content: string,
  file: string,
  analysis = getCachedDocumentAnalysis(content).analysis,
): FileIndex {
  const entries: IndexEntry[] = [];
  const references: IndexReference[] = [];

  extractFromAnalysis(content, file, analysis, entries, references);
  return { file, sourceText: content, entries, references };
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
  analysis?: DocumentSemantics,
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
