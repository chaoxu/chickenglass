import type { Tree } from "@lezer/common";
import { extractRawFrontmatter } from "../parser/frontmatter";
import { parse as parseYaml } from "yaml";
import type { DocumentAnalysis, TextSource } from "../semantics/document";
import type {
  BlockNode,
  DocumentIR,
  DocumentMetadata,
  MathNode,
  ReferenceNode,
  SectionNode,
  TableCellIR,
  TableNode,
  TableRowIR,
} from "./types";

type IRCompatibleAnalysis = Pick<
  DocumentAnalysis,
  "headings" | "fencedDivs" | "equations" | "references"
>;

export interface DocumentIRBuildInput {
  readonly analysis: IRCompatibleAnalysis;
  readonly doc: TextSource;
  readonly docText: string;
  readonly tree: Tree;
}

interface FlatHeading {
  readonly heading: string;
  readonly level: number;
  readonly from: number;
  readonly number: string;
  readonly id?: string;
}

function extractMetadata(docText: string): DocumentMetadata {
  const extracted = extractRawFrontmatter(docText);
  if (!extracted) return { raw: {} };

  let parsed: unknown;
  try {
    parsed = parseYaml(extracted.raw);
  } catch {
    // Invalid YAML should not block the rest of the IR.
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

function buildSectionTree(
  headings: readonly FlatHeading[],
  docLength: number,
): SectionNode[] {
  if (headings.length === 0) return [];

  const rangeEnds: number[] = new Array(headings.length);
  for (let index = 0; index < headings.length; index++) {
    let end = docLength;
    for (let nextIndex = index + 1; nextIndex < headings.length; nextIndex++) {
      if (headings[nextIndex].level <= headings[index].level) {
        end = headings[nextIndex].from;
        break;
      }
    }
    rangeEnds[index] = end;
  }

  function buildChildren(start: number, parentEnd: number, parentLevel: number): {
    children: SectionNode[];
    nextIndex: number;
  } {
    const children: SectionNode[] = [];
    let index = start;

    while (index < headings.length && headings[index].from < parentEnd) {
      const heading = headings[index];
      if (heading.level <= parentLevel) break;

      const sectionEnd = Math.min(rangeEnds[index], parentEnd);
      const nested = buildChildren(index + 1, sectionEnd, heading.level);

      children.push({
        heading: heading.heading,
        level: heading.level,
        range: { from: heading.from, to: sectionEnd },
        number: heading.number,
        id: heading.id,
        children: nested.children,
      });

      index = nested.nextIndex;
    }

    return { children, nextIndex: index };
  }

  return buildChildren(0, docLength, 0).children;
}

function extractTables(doc: TextSource, tree: Tree): TableNode[] {
  const tables: TableNode[] = [];

  tree.iterate({
    enter(node) {
      if (node.type.name !== "Table") return;

      const tableNode = node.node;
      const headerNode = tableNode.getChild("TableHeader");
      if (!headerNode) return;

      const rows: TableRowIR[] = [];
      let child = tableNode.firstChild;
      while (child) {
        if (child.name === "TableRow") {
          rows.push(extractTableRow(doc, child));
        }
        child = child.nextSibling;
      }

      tables.push({
        header: extractTableRow(doc, headerNode),
        rows,
        range: { from: node.from, to: node.to },
      });
    },
  });

  return tables;
}

function extractTableRow(
  doc: TextSource,
  rowNode: { getChildren: (name: string) => { from: number; to: number }[] },
): TableRowIR {
  const cells: TableCellIR[] = rowNode.getChildren("TableCell").map((cell) => ({
    content: doc.slice(cell.from, cell.to).trim(),
  }));
  return { cells };
}

function extractDivBody(
  docText: string,
  openFenceTo: number,
  closeFenceFrom: number,
  divTo: number,
): string {
  let bodyStart = openFenceTo;
  while (bodyStart < docText.length && docText[bodyStart] !== "\n") bodyStart++;
  if (bodyStart < docText.length && docText[bodyStart] === "\n") bodyStart++;

  let bodyEnd = closeFenceFrom < 0 ? divTo : closeFenceFrom;
  if (closeFenceFrom >= 0 && bodyEnd > 0 && docText[bodyEnd - 1] === "\n") {
    bodyEnd--;
  }

  if (bodyEnd <= bodyStart) return "";
  return docText.slice(bodyStart, bodyEnd);
}

export function buildDocumentIR({
  analysis,
  doc,
  docText,
  tree,
}: DocumentIRBuildInput): DocumentIR {
  const metadata = extractMetadata(docText);

  const sections = buildSectionTree(
    analysis.headings.map((heading) => ({
      heading: heading.text,
      level: heading.level,
      from: heading.from,
      number: heading.number,
      id: heading.id,
    })),
    docText.length,
  );

  const blocks: BlockNode[] = analysis.fencedDivs.map((div) => ({
    type: div.primaryClass ?? "div",
    title: div.title,
    label: div.id,
    range: { from: div.from, to: div.to },
    content: extractDivBody(docText, div.openFenceTo, div.closeFenceFrom, div.to),
  }));

  const math: MathNode[] = analysis.equations.map((equation) => ({
    latex: equation.latex,
    display: true,
    label: equation.id,
    number: equation.number,
    range: { from: equation.from, to: equation.to },
  }));

  const references: ReferenceNode[] = analysis.references.map((reference) => ({
    ids: reference.ids,
    range: { from: reference.from, to: reference.to },
    bracketed: reference.bracketed,
  }));

  return {
    metadata,
    sections,
    blocks,
    math,
    references,
    tables: extractTables(doc, tree),
  };
}
