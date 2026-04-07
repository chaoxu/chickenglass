/**
 * Extraction functions that parse markdown content using the shared
 * document analysis layer instead of bespoke tree walks.
 */

import {
  type DocumentSemantics,
  type FencedDivSemantics,
} from "../semantics/document";
import { analyzeMarkdownSemantics } from "../semantics/markdown-analysis";
import type { IndexEntry, IndexReference, FileIndex } from "./query-api";

export function extractFileIndex(
  content: string,
  file: string,
): FileIndex {
  const analysis = analyzeMarkdownSemantics(content);
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
  for (const div of analysis.fencedDivs) {
    entries.push({
      type: div.primaryClass ?? "div",
      label: div.id,
      title: div.title,
      file,
      position: { from: div.from, to: div.to },
      content: extractFencedDivBody(div, content),
    });
  }

  for (const equation of analysis.equations) {
    entries.push({
      type: "equation",
      label: equation.id,
      file,
      position: { from: equation.from, to: equation.to },
      content: equation.latex,
    });
  }

  for (const heading of analysis.headings) {
    entries.push({
      type: "heading",
      label: heading.id,
      number: heading.number || undefined,
      title: heading.text,
      file,
      position: { from: heading.from, to: heading.to },
      content: heading.text,
    });
  }

  for (const ref of analysis.references) {
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
): Map<string, FileIndex> {
  const newFiles = new Map(existingFiles);
  const fileIndex = extractFileIndex(content, file);
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
