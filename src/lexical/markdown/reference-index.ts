import { type DocumentScan, scanDocument } from "../../app/markdown/labels";
import type { FrontmatterConfig } from "../../lib/frontmatter";
import { normalizeBlockType, resolveBlockNumbering, resolveBlockTitle } from "./block-metadata";
import { FOOTNOTE_DEFINITION_MULTILINE_RE } from "./footnotes";

export interface RenderReferenceEntry {
  readonly blockType?: string;
  readonly kind: "block" | "citation" | "equation" | "footnote" | "heading";
  readonly label: string;
  readonly shortLabel?: string;
}

export interface RenderIndex {
  readonly footnotes: ReadonlyMap<string, number>;
  readonly references: ReadonlyMap<string, RenderReferenceEntry>;
}

function nextCounter(counters: Map<string, number>, blockType: string): number {
  const next = (counters.get(blockType) ?? 0) + 1;
  counters.set(blockType, next);
  return next;
}

export function buildRenderIndexFromSnapshot(
  snapshot: DocumentScan,
  config?: FrontmatterConfig,
): RenderIndex {
  return buildRenderIndex(snapshot.doc, config, snapshot);
}

export function buildRenderIndex(
  doc: string,
  config?: FrontmatterConfig,
  scan: DocumentScan = scanDocument(doc),
): RenderIndex {
  const references = new Map<string, RenderReferenceEntry>();
  const footnotes = new Map<string, number>();

  let headingCounter = 0;
  for (const heading of scan.headings) {
    if (!heading.id) {
      continue;
    }
    headingCounter += 1;
    references.set(heading.id, {
      kind: "heading",
      label: heading.number ? `Section ${heading.number}` : heading.text,
      shortLabel: heading.number || `${headingCounter}`,
    });
  }

  let equationCounter = 0;
  for (const equation of scan.equations) {
    if (!equation.id) {
      continue;
    }
    equationCounter += 1;
    references.set(equation.id, {
      kind: "equation",
      label: `Equation (${equationCounter})`,
      shortLabel: `(${equationCounter})`,
    });
  }

  const blockCounters = new Map<string, number>();
  for (const block of scan.blocks) {
    if (!block.id) {
      continue;
    }
    const blockType = normalizeBlockType(block.blockType, block.title);
    const labelBase = resolveBlockTitle(blockType, config);
    const numbering = resolveBlockNumbering(blockType, config);
    const number = numbering.numbered && numbering.counterGroup
      ? nextCounter(blockCounters, numbering.counterGroup)
      : undefined;
    references.set(block.id, {
      kind: "block",
      blockType,
      label: number !== undefined ? `${labelBase} ${number}` : labelBase,
      shortLabel: number !== undefined ? `${labelBase} ${number}` : labelBase,
    });
  }

  // Single multiline regex pass over `doc` — avoids materializing every line
  // of the doc into a separate array just to scan for footnote definitions.
  let footnoteCounter = 0;
  for (const match of doc.matchAll(FOOTNOTE_DEFINITION_MULTILINE_RE)) {
    const id = match[1];
    if (footnotes.has(id)) {
      continue;
    }
    footnoteCounter += 1;
    footnotes.set(id, footnoteCounter);
  }

  return {
    footnotes,
    references,
  };
}
