import { buildDocumentLabelGraphFromSnapshot } from "../app/markdown/label-graph";
import { buildDocumentLabelParseSnapshot } from "../app/markdown/label-parser";
import type { IndexEntry, IndexReference, FileIndex } from "./query-api";

export function extractFileIndex(
  content: string,
  file: string,
): FileIndex {
  const entries: IndexEntry[] = [];
  const references: IndexReference[] = [];
  const snapshot = buildDocumentLabelParseSnapshot(content);
  const headings = snapshot.headings;
  const blocks = snapshot.blocks;
  const equations = snapshot.equations;
  const graph = buildDocumentLabelGraphFromSnapshot(snapshot);

  for (const heading of headings) {
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

  for (const block of blocks) {
    entries.push({
      type: block.blockType ?? "div",
      label: block.id,
      title: block.title,
      file,
      position: { from: block.from, to: block.to },
      content: block.content,
    });
  }

  for (const equation of equations) {
    entries.push({
      type: "equation",
      label: equation.id,
      file,
      position: { from: equation.from, to: equation.to },
      content: equation.text,
    });
  }

  const clusteredReferences = new Map<string, {
    bracketed: boolean;
    ids: string[];
    locators: Array<string | undefined>;
    sourceFile: string;
    position: { from: number; to: number };
  }>();
  for (const reference of graph.references) {
    const key = `${reference.clusterFrom}:${reference.clusterTo}`;
    const existing = clusteredReferences.get(key);
    if (existing) {
      existing.ids.push(reference.id);
      existing.locators.push(reference.locator);
      continue;
    }
    clusteredReferences.set(key, {
      bracketed: reference.bracketed,
      ids: [reference.id],
      locators: [reference.locator],
      sourceFile: file,
      position: { from: reference.clusterFrom, to: reference.clusterTo },
    });
  }

  references.push(...Array.from(clusteredReferences.values(), (reference) => ({
    ...reference,
    ids: [...reference.ids],
    locators: [...reference.locators],
  })));

  return { file, sourceText: content, entries, references };
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
