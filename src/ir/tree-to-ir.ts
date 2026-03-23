/**
 * Lezer tree-to-IR converter.
 *
 * Walks a Lezer syntax tree and the source text to produce a
 * {@link DocumentIR}. Uses the shared semantics layer from
 * `src/semantics/document.ts` for headings, fenced divs, equations,
 * and references — then adds table extraction and section nesting.
 *
 * Zero imports from editor/, render/, app/, or plugins/.
 */

import type { Tree } from "@lezer/common";
import {
  analyzeDocumentSemantics,
  stringTextSource,
  type TextSource,
} from "../semantics/document";
import { extractRawFrontmatter } from "../parser/frontmatter";
import { parse as parseYaml } from "yaml";
import type {
  DocumentIR,
  DocumentMetadata,
  SectionNode,
  BlockNode,
  MathNode,
  ReferenceNode,
  TableNode,
  TableRowIR,
  TableCellIR,
} from "./types";

// ---------------------------------------------------------------------------
// Frontmatter → DocumentMetadata
// ---------------------------------------------------------------------------

function extractMetadata(doc: string): DocumentMetadata {
  const extracted = extractRawFrontmatter(doc);
  if (!extracted) return { raw: {} };

  let parsed: unknown;
  try {
    parsed = parseYaml(extracted.raw);
  } catch {
    return { raw: {} };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { raw: {} };
  }

  const raw = parsed as Record<string, unknown>;
  return {
    title: typeof raw["title"] === "string" ? raw["title"] : undefined,
    author: typeof raw["author"] === "string" ? raw["author"] : undefined,
    date: typeof raw["date"] === "string" ? raw["date"] : undefined,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Sections: nest headings into a tree
// ---------------------------------------------------------------------------

interface FlatHeading {
  readonly heading: string;
  readonly level: number;
  readonly from: number;
  readonly to: number;
  readonly number: string;
  readonly id?: string;
}

/**
 * Build a section tree from a flat heading list.
 *
 * Each heading's range extends from its own start to just before the next
 * heading at the same or higher level, or to `docLength`.
 */
function buildSectionTree(
  headings: readonly FlatHeading[],
  docLength: number,
): SectionNode[] {
  if (headings.length === 0) return [];

  // Compute each heading's range end: extends to the start of the next
  // heading at the same or higher level, or to docLength.
  const rangeEnds: number[] = new Array(headings.length);
  for (let i = 0; i < headings.length; i++) {
    let end = docLength;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[i].level) {
        end = headings[j].from;
        break;
      }
    }
    rangeEnds[i] = end;
  }

  // Recursive builder: processes headings in [start, headings.length) that
  // are children of a parent at `parentLevel`.
  function buildChildren(start: number, parentEnd: number, parentLevel: number): {
    children: SectionNode[];
    nextIndex: number;
  } {
    const children: SectionNode[] = [];
    let i = start;

    while (i < headings.length && headings[i].from < parentEnd) {
      const h = headings[i];
      if (h.level <= parentLevel) break;

      const sectionEnd = Math.min(rangeEnds[i], parentEnd);
      const nested = buildChildren(i + 1, sectionEnd, h.level);

      children.push({
        heading: h.heading,
        level: h.level,
        range: { from: h.from, to: sectionEnd },
        number: h.number,
        id: h.id,
        children: nested.children,
      });

      i = nested.nextIndex;
    }

    return { children, nextIndex: i };
  }

  return buildChildren(0, docLength, 0).children;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function extractTables(doc: TextSource, tree: Tree): TableNode[] {
  const tables: TableNode[] = [];

  tree.iterate({
    enter(node) {
      if (node.type.name !== "Table") return;

      const tableNode = node.node;
      let header: TableRowIR | undefined;
      const rows: TableRowIR[] = [];

      const headerNode = tableNode.getChild("TableHeader");
      if (headerNode) {
        header = extractTableRow(doc, headerNode);
      }

      let child = tableNode.firstChild;
      while (child) {
        if (child.name === "TableRow") {
          rows.push(extractTableRow(doc, child));
        }
        child = child.nextSibling;
      }

      if (header) {
        tables.push({
          header,
          rows,
          range: { from: node.from, to: node.to },
        });
      }
    },
  });

  return tables;
}

function extractTableRow(
  doc: TextSource,
  rowNode: { getChildren: (name: string) => { from: number; to: number }[] },
): TableRowIR {
  const cellNodes = rowNode.getChildren("TableCell");
  const cells: TableCellIR[] = cellNodes.map((cell) => ({
    content: doc.slice(cell.from, cell.to).trim(),
  }));
  return { cells };
}

// ---------------------------------------------------------------------------
// Fenced div body extraction (mirrors index/extract.ts logic)
// ---------------------------------------------------------------------------

function extractDivBody(
  doc: string,
  openFenceTo: number,
  closeFenceFrom: number,
  divTo: number,
): string {
  let bodyStart = openFenceTo;
  while (bodyStart < doc.length && doc[bodyStart] !== "\n") bodyStart++;
  if (bodyStart < doc.length && doc[bodyStart] === "\n") bodyStart++;

  let bodyEnd: number;
  if (closeFenceFrom < 0) {
    bodyEnd = divTo;
  } else {
    bodyEnd = closeFenceFrom;
    if (bodyEnd > 0 && doc[bodyEnd - 1] === "\n") bodyEnd--;
  }

  if (bodyEnd <= bodyStart) return "";
  return doc.slice(bodyStart, bodyEnd);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Lezer syntax tree and source text into a structured {@link DocumentIR}.
 *
 * The tree should be parsed with the shared `markdownExtensions` from
 * `src/parser/` so that fenced divs, math, equation labels, footnotes,
 * and tables are all present in the tree.
 */
export function treeToIR(tree: Tree, doc: string): DocumentIR {
  const textSource = stringTextSource(doc);
  const semantics = analyzeDocumentSemantics(textSource, tree);

  // Metadata from frontmatter
  const metadata = extractMetadata(doc);

  // Sections from headings
  const flatHeadings: FlatHeading[] = semantics.headings.map((h) => ({
    heading: h.text,
    level: h.level,
    from: h.from,
    to: h.to,
    number: h.number,
    id: h.id,
  }));
  const sections = buildSectionTree(flatHeadings, doc.length);

  // Blocks from fenced divs
  const blocks: BlockNode[] = semantics.fencedDivs.map((div) => ({
    type: div.primaryClass ?? "div",
    title: div.title,
    label: div.id,
    range: { from: div.from, to: div.to },
    content: extractDivBody(doc, div.openFenceTo, div.closeFenceFrom, div.to),
  }));

  // Math from labeled equations
  const math: MathNode[] = semantics.equations.map((eq) => ({
    latex: eq.latex,
    display: true,
    label: eq.id,
    number: eq.number,
    range: { from: eq.from, to: eq.to },
  }));

  // References
  const references: ReferenceNode[] = semantics.references.map((ref) => ({
    ids: ref.ids,
    range: { from: ref.from, to: ref.to },
    bracketed: ref.bracketed,
  }));

  // Tables (not yet in the semantics layer, so we walk the tree directly)
  const tables = extractTables(textSource, tree);

  return { metadata, sections, blocks, math, references, tables };
}
