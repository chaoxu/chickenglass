/**
 * Extraction functions that parse markdown content using the shared
 * document analysis layer instead of bespoke tree walks.
 */

import {
  type DocumentSemantics,
} from "../semantics/document";
import type { DocumentArtifacts } from "../semantics/incremental/engine";
import {
  getDocumentArtifacts,
  rememberDocumentAnalysisSnapshot,
} from "../semantics/incremental/cached-document-analysis";
import type { BlockNode, DocumentIR, MathNode, ReferenceNode, SectionNode } from "../ir/types";
import type { FileIndex, IndexEntry, IndexReference } from "./query-api";

const fileIndexAnalysisCache = new WeakMap<FileIndex, DocumentSemantics>();

export type FileIndexAnalysisInput = DocumentSemantics | DocumentArtifacts;

export function extractFileIndex(
  content: string,
  file: string,
  analysis?: FileIndexAnalysisInput,
): FileIndex {
  const artifacts = resolveArtifacts(content, file, analysis);
  const entries: IndexEntry[] = [];
  const references: IndexReference[] = [];

  extractFromIR(file, artifacts.ir, entries, references);
  const fileIndex = { file, sourceText: content, entries, references };
  fileIndexAnalysisCache.set(fileIndex, artifacts.analysisSnapshot);
  return fileIndex;
}

function resolveArtifacts(
  content: string,
  file: string,
  analysis: FileIndexAnalysisInput | undefined,
): DocumentArtifacts {
  if (!analysis) {
    return getDocumentArtifacts(content, file);
  }

  if (isDocumentArtifacts(analysis)) {
    rememberDocumentAnalysisSnapshot(content, analysis.analysisSnapshot, file);
    return analysis;
  }

  rememberDocumentAnalysisSnapshot(content, analysis, file);
  return getDocumentArtifacts(content, file);
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

function extractFromIR(
  file: string,
  ir: DocumentIR,
  entries: IndexEntry[],
  references: IndexReference[],
): void {
  appendBlockEntries(file, ir.blocks, entries);
  appendEquationEntries(file, ir.math, entries);
  appendHeadingEntries(file, ir.sections, entries);
  appendReferences(file, ir.references, references);
}

function appendBlockEntries(
  file: string,
  blocks: readonly BlockNode[],
  entries: IndexEntry[],
): void {
  for (const block of blocks) {
    entries.push({
      type: block.type,
      label: block.label,
      number: block.number === undefined ? undefined : String(block.number),
      title: block.title,
      file,
      position: block.range,
      content: block.content,
    });
  }
}

function appendEquationEntries(
  file: string,
  math: readonly MathNode[],
  entries: IndexEntry[],
): void {
  for (const equation of math) {
    if (!equation.display || !equation.label) continue;
    entries.push({
      type: "equation",
      label: equation.label,
      file,
      position: equation.range,
      content: equation.latex,
    });
  }
}

function appendHeadingEntries(
  file: string,
  sections: readonly SectionNode[],
  entries: IndexEntry[],
): void {
  for (const section of walkSections(sections)) {
    entries.push({
      type: "heading",
      label: section.id,
      number: section.number || undefined,
      title: section.heading,
      file,
      position: section.range,
      content: section.heading,
    });
  }
}

function appendReferences(
  file: string,
  irReferences: readonly ReferenceNode[],
  references: IndexReference[],
): void {
  for (const ref of irReferences) {
    references.push({
      bracketed: ref.bracketed,
      ids: ref.ids,
      locators: ref.locators,
      sourceFile: file,
      position: ref.range,
    });
  }
}

function* walkSections(sections: readonly SectionNode[]): Generator<SectionNode> {
  for (const section of sections) {
    yield section;
    yield* walkSections(section.children);
  }
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
