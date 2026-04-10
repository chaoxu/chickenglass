import { extractHeadingDefinitions } from "./headings";
import { maskMarkdownCodeSpansAndBlocks } from "./masking";
import { getTextLineAtOffset, getTextLines } from "./text-lines";

const LOCAL_LABEL_RE = /^[A-Za-z0-9_][\w.:-]*$/;
const LABEL_ID_RE = /#([A-Za-z0-9_][\w.:-]*)/;
const CLASS_RE = /\.([A-Za-z][\w-]*)/;
const BRACKETED_REFERENCE_RE = /\[(?:[^\]\n]|\\.)*?@[^\]\n]*\]/g;
const REFERENCE_ID_RE = /@([A-Za-z0-9_][\w.:-]*)/g;

export type DocumentLabelKind = "block" | "equation" | "heading";

export interface DocumentLabelDefinition {
  readonly id: string;
  readonly kind: DocumentLabelKind;
  readonly from: number;
  readonly to: number;
  readonly tokenFrom: number;
  readonly tokenTo: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly displayLabel: string;
  readonly number?: string;
  readonly title?: string;
  readonly text?: string;
  readonly blockType?: string;
  readonly content?: string;
}

export interface DocumentLabelReference {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly clusterFrom: number;
  readonly clusterTo: number;
  readonly clusterIndex: number;
  readonly bracketed: boolean;
  readonly locator?: string;
}

export interface DocumentLabelRenameValidation {
  readonly ok: boolean;
  readonly id: string;
  readonly reason?: "empty" | "invalid-format" | "collision";
  readonly conflictingDefinitions?: readonly DocumentLabelDefinition[];
}

export interface DocumentLabelGraph {
  readonly definitions: readonly DocumentLabelDefinition[];
  readonly definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>;
  readonly uniqueDefinitionById: ReadonlyMap<string, DocumentLabelDefinition>;
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>;
  readonly references: readonly DocumentLabelReference[];
  readonly referencesByTarget: ReadonlyMap<string, readonly DocumentLabelReference[]>;
}

export interface MarkdownBlock {
  readonly from: number;
  readonly to: number;
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly blockType?: string;
  readonly title?: string;
  readonly content: string;
}

export interface MarkdownEquation {
  readonly from: number;
  readonly to: number;
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly text: string;
}

export interface DocumentLabelBacklinkItem {
  readonly from: number;
  readonly to: number;
  readonly lineNumber: number;
  readonly referenceText: string;
  readonly contextText: string;
  readonly locator?: string;
}

export interface DocumentLabelBacklinksResult {
  readonly definition: DocumentLabelDefinition;
  readonly backlinks: readonly DocumentLabelBacklinkItem[];
  readonly source: "definition" | "reference" | "selection";
}

export type DocumentLabelBacklinksLookup =
  | {
    readonly kind: "ready";
    readonly result: DocumentLabelBacklinksResult;
  }
  | {
    readonly kind: "duplicate";
    readonly id: string;
    readonly definitions: readonly DocumentLabelDefinition[];
  }
  | {
    readonly kind: "none";
  };

export interface DocumentLabelRenameTarget {
  readonly definition: DocumentLabelDefinition;
  readonly references: readonly DocumentLabelReference[];
}

export type DocumentLabelRenameTargetLookup =
  | {
    readonly kind: "target";
    readonly target: DocumentLabelRenameTarget;
  }
  | {
    readonly kind: "duplicate";
    readonly id: string;
    readonly definitions: readonly DocumentLabelDefinition[];
  }
  | {
    readonly kind: "none";
  };

export type DocumentLabelRenamePlan =
  | {
    readonly kind: "ready";
    readonly definition: DocumentLabelDefinition;
    readonly currentId: string;
    readonly nextId: string;
    readonly referenceCount: number;
    readonly changes: ReadonlyArray<{ from: number; to: number; insert: string }>;
  }
  | {
    readonly kind: "invalid";
    readonly definition: DocumentLabelDefinition;
    readonly currentId: string;
    readonly referenceCount: number;
    readonly validation: DocumentLabelRenameValidation;
  }
  | DocumentLabelRenameTargetLookup;

interface OpenBlock {
  readonly fenceLength: number;
  readonly from: number;
  readonly id?: string;
  readonly labelFrom?: number;
  readonly labelTo?: number;
  readonly blockType?: string;
  readonly title?: string;
  readonly bodyFrom: number;
}

function getLabelSpan(lineText: string, lineStart: number): {
  id?: string;
  labelFrom?: number;
  labelTo?: number;
} {
  const labelMatch = lineText.match(LABEL_ID_RE);
  if (!labelMatch) {
    return {};
  }
  const id = labelMatch[1];
  const tokenIndex = lineText.indexOf(`#${id}`);
  return {
    id,
    labelFrom: lineStart + tokenIndex + 1,
    labelTo: lineStart + tokenIndex + 1 + id.length,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const headLength = Math.ceil((maxLength - 3) / 2);
  const tailLength = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, headLength)}...${text.slice(text.length - tailLength)}`;
}

function normalizeContext(text: string): string {
  return truncateMiddle(normalizeText(text), 140);
}

function trimTrailingReferencePunctuation(id: string): string {
  return id.replace(/\.+$/, "");
}

function parseBlockHeader(rest: string): {
  readonly id?: string;
  readonly labelFromInHeader?: number;
  readonly blockType?: string;
  readonly title?: string;
} {
  const trimmed = rest.trimStart();
  if (!trimmed.startsWith("{")) {
    return {
      title: trimmed.trim() || undefined,
    };
  }

  const closingIndex = trimmed.indexOf("}");
  if (closingIndex < 0) {
    return {};
  }

  const attrs = trimmed.slice(0, closingIndex + 1);
  const title = trimmed.slice(closingIndex + 1).trim() || undefined;
  const idMatch = attrs.match(LABEL_ID_RE);
  const classMatch = attrs.match(CLASS_RE);
  return {
    id: idMatch?.[1],
    labelFromInHeader: idMatch ? trimmed.indexOf(`#${idMatch[1]}`) + 1 : undefined,
    blockType: classMatch?.[1],
    title,
  };
}

export function extractMarkdownBlocks(doc: string, scanDoc = doc): MarkdownBlock[] {
  const lines = getTextLines(doc);
  const scanLines = getTextLines(scanDoc);
  const stack: OpenBlock[] = [];
  const blocks: MarkdownBlock[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const scanLine = scanLines[lineIndex];
    const match = scanLine.text.match(/^\s*(:{3,})(.*)$/);
    if (!match) {
      continue;
    }

    const fenceLength = match[1].length;
    const rest = match[2];
    if (/^\s*$/.test(rest)) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const open = stack[index];
        if (fenceLength < open.fenceLength) {
          continue;
        }
        stack.splice(index, 1);
        const contentEnd = line.start > 0 && doc[line.start - 1] === "\n"
          ? line.start - 1
          : line.start;
        blocks.push({
          from: open.from,
          to: line.end,
          id: open.id,
          labelFrom: open.labelFrom,
          labelTo: open.labelTo,
          blockType: open.blockType,
          title: open.title,
          content: doc.slice(open.bodyFrom, contentEnd),
        });
        break;
      }
      continue;
    }

    const header = parseBlockHeader(rest);
    stack.push({
      fenceLength,
      from: line.start,
      id: header.id,
      labelFrom: header.id && header.labelFromInHeader !== undefined
        ? line.start + line.text.indexOf(rest) + header.labelFromInHeader
        : undefined,
      labelTo: header.id && header.labelFromInHeader !== undefined
        ? line.start + line.text.indexOf(rest) + header.labelFromInHeader + header.id.length
        : undefined,
      blockType: header.blockType,
      title: header.title,
      bodyFrom: line.end < doc.length ? line.end + 1 : line.end,
    });
  }

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const open = stack[index];
    blocks.push({
      from: open.from,
      to: doc.length,
      id: open.id,
      labelFrom: open.labelFrom,
      labelTo: open.labelTo,
      blockType: open.blockType,
      title: open.title,
      content: doc.slice(open.bodyFrom),
    });
  }

  return blocks;
}

export function extractMarkdownEquations(doc: string, scanDoc = doc): MarkdownEquation[] {
  const lines = getTextLines(doc);
  const scanLines = getTextLines(scanDoc);
  const equations: MarkdownEquation[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const scanLine = scanLines[lineIndex];
    const trimmed = scanLine.text.trim();

    if (trimmed.startsWith("$$")) {
      const secondFence = scanLine.text.indexOf("$$", scanLine.text.indexOf("$$") + 2);
      if (secondFence >= 0) {
        const afterFence = line.text.slice(secondFence + 2);
        const { id, labelFrom, labelTo } = getLabelSpan(afterFence, line.start + secondFence + 2);
        equations.push({
          from: line.start,
          to: line.end,
          id,
          labelFrom,
          labelTo,
          text: line.text.slice(line.text.indexOf("$$") + 2, secondFence).trim(),
        });
        continue;
      }

      for (let endIndex = lineIndex + 1; endIndex < lines.length; endIndex += 1) {
        const endLine = lines[endIndex];
        const scanEndLine = scanLines[endIndex];
        if (!scanEndLine.text.trim().startsWith("$$")) {
          continue;
        }
        const { id, labelFrom, labelTo } = getLabelSpan(endLine.text, endLine.start);
        const text = lines
          .slice(lineIndex + 1, endIndex)
          .map((entry) => entry.text)
          .join("\n")
          .trim();
        equations.push({
          from: line.start,
          to: endLine.end,
          id,
          labelFrom,
          labelTo,
          text,
        });
        lineIndex = endIndex;
        break;
      }
      continue;
    }

    if (trimmed === "\\[") {
      for (let endIndex = lineIndex + 1; endIndex < lines.length; endIndex += 1) {
        const endLine = lines[endIndex];
        const scanEndLine = scanLines[endIndex];
        if (!scanEndLine.text.trim().startsWith("\\]")) {
          continue;
        }
        const { id, labelFrom, labelTo } = getLabelSpan(endLine.text, endLine.start);
        const text = lines
          .slice(lineIndex + 1, endIndex)
          .map((entry) => entry.text)
          .join("\n")
          .trim();
        equations.push({
          from: line.start,
          to: endLine.end,
          id,
          labelFrom,
          labelTo,
          text,
        });
        lineIndex = endIndex;
        break;
      }
    }
  }

  return equations;
}

export function extractDocumentLabelReferences(doc: string, scanDoc = doc): DocumentLabelReference[] {
  const references: DocumentLabelReference[] = [];
  const coveredRanges: Array<{ from: number; to: number }> = [];

  for (const match of scanDoc.matchAll(BRACKETED_REFERENCE_RE)) {
    const raw = match[0];
    const clusterFrom = match.index ?? 0;
    const clusterTo = clusterFrom + raw.length;
    const body = raw.slice(1, -1);
    let clusterIndex = 0;

    for (const refMatch of body.matchAll(REFERENCE_ID_RE)) {
      const id = trimTrailingReferencePunctuation(refMatch[1]);
      if (!id) {
        continue;
      }
      const relativeFrom = refMatch.index ?? 0;
      const tokenFrom = clusterFrom + 1 + relativeFrom;
      const tokenTo = tokenFrom + 1 + id.length;
      const nextRelativeFrom = (refMatch.index ?? 0) + refMatch[0].length;
      const nextReference = body
        .slice(nextRelativeFrom)
        .search(REFERENCE_ID_RE);
      const locatorSlice = nextReference >= 0
        ? body.slice(nextRelativeFrom, nextRelativeFrom + nextReference)
        : body.slice(nextRelativeFrom);

      references.push({
        id,
        from: tokenFrom,
        to: tokenTo,
        labelFrom: tokenFrom + 1,
        labelTo: tokenTo,
        clusterFrom,
        clusterTo,
        clusterIndex,
        bracketed: true,
        locator: normalizeText(locatorSlice.replace(/^[\s;,:-]+|[\s;,:-]+$/g, "")) || undefined,
      });
      clusterIndex += 1;
    }

    coveredRanges.push({ from: clusterFrom, to: clusterTo });
  }

  outer: for (const match of scanDoc.matchAll(REFERENCE_ID_RE)) {
    const tokenFrom = match.index ?? 0;
    for (const covered of coveredRanges) {
      if (tokenFrom >= covered.from && tokenFrom < covered.to) {
        continue outer;
      }
    }

    const id = trimTrailingReferencePunctuation(match[1]);
    if (!id) {
      continue;
    }
    const tokenTo = tokenFrom + 1 + id.length;
    references.push({
      id,
      from: tokenFrom,
      to: tokenTo,
      labelFrom: tokenFrom + 1,
      labelTo: tokenTo,
      clusterFrom: tokenFrom,
      clusterTo: tokenTo,
      clusterIndex: 0,
      bracketed: false,
    });
  }

  references.sort((left, right) => left.from - right.from);
  return references;
}

function indexDefinitionsById(
  definitions: readonly DocumentLabelDefinition[],
): ReadonlyMap<string, readonly DocumentLabelDefinition[]> {
  const definitionsById = new Map<string, DocumentLabelDefinition[]>();
  for (const definition of definitions) {
    const group = definitionsById.get(definition.id) ?? [];
    group.push(definition);
    definitionsById.set(definition.id, group);
  }
  return definitionsById;
}

function indexUniqueDefinitions(
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): ReadonlyMap<string, DocumentLabelDefinition> {
  const uniqueDefinitions = new Map<string, DocumentLabelDefinition>();
  for (const [id, definitions] of definitionsById) {
    if (definitions.length === 1) {
      uniqueDefinitions.set(id, definitions[0]);
    }
  }
  return uniqueDefinitions;
}

function indexDuplicateDefinitions(
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): ReadonlyMap<string, readonly DocumentLabelDefinition[]> {
  const duplicates = new Map<string, readonly DocumentLabelDefinition[]>();
  for (const [id, definitions] of definitionsById) {
    if (definitions.length > 1) {
      duplicates.set(id, definitions);
    }
  }
  return duplicates;
}

function indexReferencesByTarget(
  references: readonly DocumentLabelReference[],
): ReadonlyMap<string, readonly DocumentLabelReference[]> {
  const referencesByTarget = new Map<string, DocumentLabelReference[]>();
  for (const reference of references) {
    const group = referencesByTarget.get(reference.id) ?? [];
    group.push(reference);
    referencesByTarget.set(reference.id, group);
  }
  return referencesByTarget;
}

export function buildDocumentLabelGraph(doc: string): DocumentLabelGraph {
  const scanDoc = maskMarkdownCodeSpansAndBlocks(doc);
  const headings = extractHeadingDefinitions(doc, scanDoc);
  const blocks = extractMarkdownBlocks(doc, scanDoc);
  const equations = extractMarkdownEquations(doc, scanDoc);

  const definitions: DocumentLabelDefinition[] = [];

  for (const heading of headings) {
    if (!heading.id || heading.labelFrom === undefined || heading.labelTo === undefined) {
      continue;
    }
    definitions.push({
      id: heading.id,
      kind: "heading",
      from: heading.from,
      to: heading.to,
      tokenFrom: heading.labelFrom - 1,
      tokenTo: heading.labelTo,
      labelFrom: heading.labelFrom,
      labelTo: heading.labelTo,
      displayLabel: heading.number || heading.id,
      number: heading.number || undefined,
      title: heading.text,
      text: heading.text,
    });
  }

  for (const block of blocks) {
    if (!block.id || block.labelFrom === undefined || block.labelTo === undefined) {
      continue;
    }
    definitions.push({
      id: block.id,
      kind: "block",
      from: block.from,
      to: block.to,
      tokenFrom: block.labelFrom - 1,
      tokenTo: block.labelTo,
      labelFrom: block.labelFrom,
      labelTo: block.labelTo,
      displayLabel: block.id,
      title: block.title,
      text: block.content,
      blockType: block.blockType,
      content: block.content,
    });
  }

  for (const equation of equations) {
    if (!equation.id || equation.labelFrom === undefined || equation.labelTo === undefined) {
      continue;
    }
    definitions.push({
      id: equation.id,
      kind: "equation",
      from: equation.from,
      to: equation.to,
      tokenFrom: equation.labelFrom - 1,
      tokenTo: equation.labelTo,
      labelFrom: equation.labelFrom,
      labelTo: equation.labelTo,
      displayLabel: equation.id,
      text: equation.text,
    });
  }

  const references = extractDocumentLabelReferences(doc, scanDoc);
  const definitionsById = indexDefinitionsById(definitions);
  const uniqueDefinitionById = indexUniqueDefinitions(definitionsById);
  const duplicatesById = indexDuplicateDefinitions(definitionsById);
  const referencesByTarget = indexReferencesByTarget(references);

  return {
    definitions,
    definitionsById,
    uniqueDefinitionById,
    duplicatesById,
    references,
    referencesByTarget,
  };
}

export function findDocumentLabelBacklinks(
  graph: DocumentLabelGraph,
  id: string,
): readonly DocumentLabelReference[] {
  return graph.referencesByTarget.get(id) ?? [];
}

export function validateDocumentLabelRename(
  graph: DocumentLabelGraph,
  nextId: string,
  options?: { currentId?: string },
): DocumentLabelRenameValidation {
  const id = nextId.trim();
  if (!id) {
    return { ok: false, id, reason: "empty" };
  }
  if (!LOCAL_LABEL_RE.test(id)) {
    return { ok: false, id, reason: "invalid-format" };
  }

  const conflictingDefinitions = graph.definitionsById.get(id) ?? [];
  const currentId = options?.currentId;
  const hasCollision = conflictingDefinitions.some((definition) => definition.id !== currentId);
  if (hasCollision) {
    return {
      ok: false,
      id,
      reason: "collision",
      conflictingDefinitions,
    };
  }

  return { ok: true, id };
}

function selectionTouchesRange(
  selectionFrom: number,
  selectionTo: number,
  rangeFrom: number,
  rangeTo: number,
): boolean {
  if (selectionFrom === selectionTo) {
    return selectionFrom >= rangeFrom && selectionFrom <= rangeTo;
  }
  return selectionFrom < rangeTo && selectionTo > rangeFrom;
}

function selectionMatchesRange(
  selectionFrom: number,
  selectionTo: number,
  rangeFrom: number,
  rangeTo: number,
): boolean {
  if (selectionFrom === selectionTo) {
    return selectionFrom >= rangeFrom && selectionFrom <= rangeTo;
  }
  return selectionFrom >= rangeFrom && selectionTo <= rangeTo;
}

function findMatchingReference(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelReference | undefined {
  return graph.references
    .filter((reference) => selectionTouchesRange(selectionFrom, selectionTo, reference.from, reference.to))
    .sort((left, right) => ((left.to - left.from) - (right.to - right.from)) || (left.from - right.from))[0];
}

function findMatchingDefinition(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelDefinition | undefined {
  return graph.definitions
    .filter((definition) =>
      selectionTouchesRange(selectionFrom, selectionTo, definition.from, definition.to))
    .sort((left, right) => ((left.to - left.from) - (right.to - right.from)) || (left.from - right.from))[0];
}

function findRenameDefinition(
  graph: DocumentLabelGraph,
  selectionFrom: number,
  selectionTo: number,
): DocumentLabelDefinition | undefined {
  return graph.definitions
    .filter((definition) =>
      selectionMatchesRange(selectionFrom, selectionTo, definition.tokenFrom, definition.tokenTo))
    .sort((left, right) => ((left.to - left.from) - (right.to - right.from)) || (left.from - right.from))[0];
}

function buildBacklinkItem(
  doc: string,
  reference: DocumentLabelReference,
): DocumentLabelBacklinkItem {
  const line = getTextLineAtOffset(doc, reference.clusterFrom);
  return {
    from: reference.from,
    to: reference.to,
    lineNumber: line.number,
    referenceText: doc.slice(reference.from, reference.to),
    contextText: normalizeContext(line.text),
    locator: reference.locator,
  };
}

function readyBacklinksResult(
  doc: string,
  graph: DocumentLabelGraph,
  definition: DocumentLabelDefinition,
  source: DocumentLabelBacklinksResult["source"],
): DocumentLabelBacklinksLookup {
  return {
    kind: "ready",
    result: {
      definition,
      backlinks: findDocumentLabelBacklinks(graph, definition.id).map((reference) =>
        buildBacklinkItem(doc, reference)),
      source,
    },
  };
}

function duplicateLookup(
  graph: DocumentLabelGraph,
  id: string,
): {
  readonly kind: "duplicate";
  readonly id: string;
  readonly definitions: readonly DocumentLabelDefinition[];
} {
  return {
    kind: "duplicate",
    id,
    definitions: graph.definitionsById.get(id) ?? [],
  };
}

export function resolveDocumentLabelBacklinks(
  doc: string,
  selectionFrom: number,
  selectionTo = selectionFrom,
): DocumentLabelBacklinksLookup {
  const graph = buildDocumentLabelGraph(doc);
  const reference = findMatchingReference(graph, selectionFrom, selectionTo);
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      return readyBacklinksResult(doc, graph, definition, "reference");
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateLookup(graph, reference.id);
    }
  }

  const definition = findMatchingDefinition(graph, selectionFrom, selectionTo);
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateLookup(graph, definition.id);
    }
    return readyBacklinksResult(doc, graph, definition, "definition");
  }

  if (selectionFrom !== selectionTo) {
    const id = doc.slice(selectionFrom, selectionTo).trim();
    const selectedDefinition = graph.uniqueDefinitionById.get(id);
    if (selectedDefinition) {
      return readyBacklinksResult(doc, graph, selectedDefinition, "selection");
    }
    if (graph.duplicatesById.has(id)) {
      return duplicateLookup(graph, id);
    }
  }

  return { kind: "none" };
}

function buildRenameChanges(
  definition: DocumentLabelDefinition,
  references: readonly DocumentLabelReference[],
  nextId: string,
): ReadonlyArray<{ from: number; to: number; insert: string }> {
  const spans = [
    { from: definition.labelFrom, to: definition.labelTo },
    ...references.map((reference) => ({
      from: reference.labelFrom,
      to: reference.labelTo,
    })),
  ];

  spans.sort((left, right) => (left.from - right.from) || (left.to - right.to));
  return spans.map((span) => ({ ...span, insert: nextId }));
}

export function resolveDocumentLabelRenameTarget(
  doc: string,
  selectionFrom: number,
  selectionTo = selectionFrom,
): DocumentLabelRenameTargetLookup {
  const graph = buildDocumentLabelGraph(doc);
  const reference = findMatchingReference(graph, selectionFrom, selectionTo);
  if (reference) {
    const definition = graph.uniqueDefinitionById.get(reference.id);
    if (definition) {
      return {
        kind: "target",
        target: {
          definition,
          references: findDocumentLabelBacklinks(graph, definition.id),
        },
      };
    }
    if (graph.definitionsById.has(reference.id)) {
      return duplicateLookup(graph, reference.id) as DocumentLabelRenameTargetLookup;
    }
  }

  const definition = findRenameDefinition(graph, selectionFrom, selectionTo);
  if (definition) {
    if (graph.duplicatesById.has(definition.id)) {
      return duplicateLookup(graph, definition.id) as DocumentLabelRenameTargetLookup;
    }
    return {
      kind: "target",
      target: {
        definition,
        references: findDocumentLabelBacklinks(graph, definition.id),
      },
    };
  }

  return { kind: "none" };
}

export function prepareDocumentLabelRename(
  doc: string,
  selectionFrom: number,
  nextId: string,
  selectionTo = selectionFrom,
): DocumentLabelRenamePlan {
  const lookup = resolveDocumentLabelRenameTarget(doc, selectionFrom, selectionTo);
  if (lookup.kind !== "target") {
    return lookup;
  }

  const graph = buildDocumentLabelGraph(doc);
  const { definition, references } = lookup.target;
  const validation = validateDocumentLabelRename(graph, nextId, {
    currentId: definition.id,
  });

  if (!validation.ok) {
    return {
      kind: "invalid",
      definition,
      currentId: definition.id,
      referenceCount: references.length,
      validation,
    };
  }

  return {
    kind: "ready",
    definition,
    currentId: definition.id,
    nextId: validation.id,
    referenceCount: references.length,
    changes: validation.id === definition.id
      ? []
      : buildRenameChanges(definition, references, validation.id),
  };
}

export function isLikelyLocalReferenceId(id: string): boolean {
  return id.includes(":");
}
