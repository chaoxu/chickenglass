/**
 * Extraction functions that parse markdown content using a Lezer syntax
 * tree and extract index entries and references. These functions are used
 * by both the web worker and tests (no worker dependency).
 *
 * Uses tree-walking instead of regex for correctness: content inside code
 * blocks, inline code, and other non-semantic contexts is properly ignored.
 */

import { parser } from "@lezer/markdown";
import type { Tree, SyntaxNode } from "@lezer/common";
import {
  removeIndentedCode,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  footnoteExtension,
} from "../parser";
import { extractDivClass } from "../parser/fenced-div-attrs";
import type { IndexEntry, IndexReference, FileIndex } from "./query-api";

/**
 * Standalone Lezer markdown parser configured with the same extensions
 * the editor uses, but without CM6 dependencies. Safe for web workers.
 */
const indexParser = parser.configure([
  removeIndentedCode,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  footnoteExtension,
]);

/** Regex to extract heading label from heading text: ... {#label} */
const HEADING_LABEL_RE = /\s+\{#([^}\s]+)\}\s*$/;

/**
 * Extract index entries and references from a single markdown file.
 *
 * Parses the content into a Lezer syntax tree and walks it to extract:
 * - Fenced div blocks with their type, label, title, and content
 * - Equation labels from DisplayMath + EquationLabel nodes
 * - Headings with optional labels
 * - Cross-references ([@label]) from Link nodes starting with @
 *
 * Content inside code blocks is correctly ignored (unlike regex).
 */
export function extractFileIndex(
  content: string,
  file: string,
): FileIndex {
  const tree = indexParser.parse(content);
  const entries: IndexEntry[] = [];
  const references: IndexReference[] = [];

  extractFromTree(tree, content, file, entries, references);

  return { file, entries, references };
}

/**
 * Walk the syntax tree and extract all indexable items.
 */
function extractFromTree(
  tree: Tree,
  content: string,
  file: string,
  entries: IndexEntry[],
  references: IndexReference[],
): void {
  const cursor = tree.cursor();

  do {
    switch (cursor.name) {
      case "FencedDiv":
        extractFencedDiv(cursor.node, content, file, entries);
        // Don't descend into children -- we handle them manually
        // and nested FencedDivs are extracted by the outer loop
        // since cursor.next() visits them at the top level
        break;

      case "DisplayMath":
        extractDisplayMath(cursor.node, content, file, entries);
        break;

      case "ATXHeading1":
      case "ATXHeading2":
      case "ATXHeading3":
      case "ATXHeading4":
      case "ATXHeading5":
      case "ATXHeading6":
        extractHeading(cursor.node, content, file, entries);
        break;

      case "Link":
        extractReference(cursor.node, content, file, references);
        break;
    }
  } while (cursor.next());
}

/**
 * Extract a fenced div block from its syntax tree node.
 *
 * Reads FencedDivAttributes and FencedDivTitle children to determine
 * type, label, and title. Extracts body content between the fences.
 */
function extractFencedDiv(
  node: SyntaxNode,
  content: string,
  file: string,
  entries: IndexEntry[],
): void {
  let type = "div";
  let id: string | undefined;
  let title: string | undefined;

  // Find FencedDivAttributes child
  const attrNode = node.getChild("FencedDivAttributes");
  if (attrNode) {
    const attrText = content.slice(attrNode.from, attrNode.to);
    const parsed = extractDivClass(attrText);
    if (parsed) {
      type = parsed.classes[0] ?? "div";
      id = parsed.id;
    }
  }

  // Find FencedDivTitle child
  const titleNode = node.getChild("FencedDivTitle");
  if (titleNode) {
    title = content.slice(titleNode.from, titleNode.to).trim() || undefined;
  }

  // Extract body content: everything between the fences, excluding
  // the fence lines themselves and the attributes/title
  const bodyContent = extractFencedDivBody(node, content);

  entries.push({
    type,
    label: id,
    title,
    file,
    position: { from: node.from, to: node.to },
    content: bodyContent,
  });
}

/**
 * Extract body content from a fenced div, excluding the opening fence
 * line (with attributes/title) and the closing fence line.
 */
function extractFencedDivBody(node: SyntaxNode, content: string): string {
  const fences = node.getChildren("FencedDivFence");

  if (fences.length === 0) {
    return "";
  }

  // Body starts after the opening fence line
  const openingFence = fences[0];
  // Find end of the opening fence line (skip to next newline)
  let bodyStart = openingFence.to;
  // The opening fence line may extend past the FencedDivFence node
  // (includes attributes and title). Find the actual line end.
  const attrNode = node.getChild("FencedDivAttributes");
  const titleNode = node.getChild("FencedDivTitle");
  if (titleNode) {
    bodyStart = titleNode.to;
  } else if (attrNode) {
    bodyStart = attrNode.to;
  }

  // Skip to end of line
  while (bodyStart < content.length && content[bodyStart] !== "\n") {
    bodyStart++;
  }
  // Skip the newline itself
  if (bodyStart < content.length && content[bodyStart] === "\n") {
    bodyStart++;
  }

  // Body ends at the closing fence (or end of node if no closing fence)
  let bodyEnd: number;
  if (fences.length >= 2) {
    const closingFence = fences[fences.length - 1];
    // Go back to the start of the closing fence line
    bodyEnd = closingFence.from;
    // Trim the trailing newline before the closing fence
    if (bodyEnd > bodyStart && content[bodyEnd - 1] === "\n") {
      bodyEnd--;
    }
  } else {
    bodyEnd = node.to;
  }

  if (bodyEnd <= bodyStart) {
    return "";
  }

  return content.slice(bodyStart, bodyEnd);
}

/**
 * Extract an equation from a DisplayMath node.
 *
 * Only creates an entry if the node contains an EquationLabel child.
 */
function extractDisplayMath(
  node: SyntaxNode,
  content: string,
  file: string,
  entries: IndexEntry[],
): void {
  const labelNode = node.getChild("EquationLabel");
  if (!labelNode) return;

  const labelText = content.slice(labelNode.from, labelNode.to);
  // EquationLabel text is like {#eq:foo}
  const match = /^\{#([^}\s]+)\}$/.exec(labelText);
  if (!match) return;

  const label = match[1];

  // Extract math content between the DisplayMathMark delimiters
  const marks = node.getChildren("DisplayMathMark");
  let mathContent = "";
  if (marks.length >= 2) {
    const afterOpen = marks[0].to;
    const beforeClose = marks[marks.length - 1].from;
    if (beforeClose > afterOpen) {
      mathContent = content.slice(afterOpen, beforeClose).trim();
    }
  }

  entries.push({
    type: "equation",
    label,
    file,
    position: { from: node.from, to: node.to },
    content: mathContent,
  });
}

/**
 * Extract a heading from an ATXHeading node.
 *
 * Determines the heading level from the node name (ATXHeading1-6),
 * and parses optional {#label} from the heading text.
 */
function extractHeading(
  node: SyntaxNode,
  content: string,
  file: string,
  entries: IndexEntry[],
): void {
  const levelChar = node.name[node.name.length - 1];
  const level = Number(levelChar);

  // Get the heading text (after the HeaderMark)
  const headerMark = node.getChild("HeaderMark");
  const textStart = headerMark ? headerMark.to : node.from;
  const rawText = content.slice(textStart, node.to);

  // Parse optional label: ... {#label}
  let headingText = rawText.trim();
  let label: string | undefined;

  const labelMatch = HEADING_LABEL_RE.exec(headingText);
  if (labelMatch) {
    label = labelMatch[1];
    // Remove the label from heading text
    headingText = headingText.slice(0, labelMatch.index).trim();
  }

  entries.push({
    type: "heading",
    label,
    number: level,
    title: headingText,
    file,
    position: { from: node.from, to: node.to },
    content: headingText,
  });
}

/**
 * Extract a cross-reference from a Link node.
 *
 * Only matches links that look like [@label] — the Lezer parser treats
 * these as Link nodes. We check that the content between the brackets
 * starts with @ and extract the label.
 */
function extractReference(
  node: SyntaxNode,
  content: string,
  file: string,
  references: IndexReference[],
): void {
  // Link text is everything between [ and ]
  const linkText = content.slice(node.from, node.to);

  // Must match pattern: [@label]
  // The full text including brackets
  const match = /^\[@([^\]]+)\]$/.exec(linkText);
  if (!match) return;

  references.push({
    label: match[1],
    sourceFile: file,
    position: { from: node.from, to: node.to },
  });
}

/**
 * Compute incremental update: re-index a single file and merge into existing index.
 * Returns a new files map with the updated file index.
 */
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

/**
 * Remove a file from the index.
 */
export function removeFileFromIndex(
  existingFiles: ReadonlyMap<string, FileIndex>,
  file: string,
): Map<string, FileIndex> {
  const newFiles = new Map(existingFiles);
  newFiles.delete(file);
  return newFiles;
}
