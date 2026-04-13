import type { DocumentLabelParseSnapshot } from "../../app/markdown/label-parser";
import { buildDocumentLabelParseSnapshot } from "../../app/markdown/label-parser";
import type { FrontmatterConfig } from "../../lib/frontmatter";
import { normalizeBlockType, resolveBlockNumbering, resolveBlockTitle } from "./block-metadata";
import { FOOTNOTE_DEFINITION_RE } from "./footnotes";

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
  snapshot: Pick<DocumentLabelParseSnapshot, "blocks" | "doc" | "equations" | "headings">,
  config?: FrontmatterConfig,
): RenderIndex {
  const references = new Map<string, RenderReferenceEntry>();
  const footnotes = new Map<string, number>();

  let headingCounter = 0;
  for (const heading of snapshot.headings) {
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
  for (const equation of snapshot.equations) {
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
  for (const block of snapshot.blocks) {
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

  let footnoteCounter = 0;
  for (const line of snapshot.doc.split("\n")) {
    const match = line.match(FOOTNOTE_DEFINITION_RE);
    if (!match || footnotes.has(match[1])) {
      continue;
    }
    footnoteCounter += 1;
    footnotes.set(match[1], footnoteCounter);
  }

  return {
    footnotes,
    references,
  };
}

export function buildRenderIndex(doc: string, config?: FrontmatterConfig): RenderIndex {
  const snapshot = buildDocumentLabelParseSnapshot(doc);
  return buildRenderIndexFromSnapshot({
    blocks: snapshot.blocks,
    doc,
    equations: snapshot.equations,
    headings: snapshot.headings,
  }, config);
}
