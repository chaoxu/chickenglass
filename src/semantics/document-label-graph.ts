import {
  type EditorState,
  StateField,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { isIdentChar, isSpaceTab } from "../parser/char-utils";
import { readBracedLabelId } from "../parser/label-utils";
import { pluginRegistryField } from "../plugins";
import { documentAnalysisField } from "./codemirror-source";
import {
  findTrailingHeadingAttributes,
  type DocumentAnalysis,
} from "./document";
import {
  getEditorDocumentReferenceCatalog,
  getDocumentAnalysisOrRecompute,
} from "./editor-reference-catalog";
import { blockCounterField } from "../state/block-counter";
import type { DocumentReferenceCatalog } from "./reference-catalog";

const EMPTY_DEFINITIONS: readonly DocumentLabelDefinition[] = [];
const EMPTY_REFERENCES: readonly DocumentLabelReference[] = [];
const LOCAL_LABEL_RE = /^[A-Za-z0-9_][\w.:-]*$/;

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

interface TokenSpan {
  readonly tokenFrom: number;
  readonly tokenTo: number;
  readonly labelFrom: number;
  readonly labelTo: number;
}

function isValidTokenBoundary(text: string, pos: number): boolean {
  return pos >= text.length || !isIdentChar(text.charCodeAt(pos));
}

function findBracketedOccurrenceSpan(
  raw: string,
  rawFrom: number,
  id: string,
  searchFrom: number,
): TokenSpan | null {
  const token = `@${id}`;
  const tokenIndex = raw.indexOf(token, searchFrom);
  if (tokenIndex < 0) return null;
  const tokenEnd = tokenIndex + token.length;
  if (!isValidTokenBoundary(raw, tokenEnd)) {
    return findBracketedOccurrenceSpan(raw, rawFrom, id, tokenIndex + 1);
  }

  return {
    tokenFrom: rawFrom + tokenIndex,
    tokenTo: rawFrom + tokenEnd,
    labelFrom: rawFrom + tokenIndex + 1,
    labelTo: rawFrom + tokenEnd,
  };
}

function skipSpaces(text: string, pos: number): number {
  while (pos < text.length && isSpaceTab(text.charCodeAt(pos))) {
    pos += 1;
  }
  return pos;
}

function readIdentifierEnd(text: string, pos: number): number {
  while (pos < text.length && isIdentChar(text.charCodeAt(pos))) {
    pos += 1;
  }
  return pos;
}

function skipAttributeValue(text: string, pos: number): number {
  if (pos >= text.length) return pos;
  if (text[pos] === "\"") {
    pos += 1;
    while (pos < text.length && text[pos] !== "\"") {
      pos += 1;
    }
    return pos < text.length ? pos + 1 : pos;
  }

  while (
    pos < text.length &&
    !isSpaceTab(text.charCodeAt(pos)) &&
    text[pos] !== "}"
  ) {
    pos += 1;
  }
  return pos;
}

function findAttributeIdSpan(
  attrText: string,
  absoluteFrom: number,
  expectedId: string,
): TokenSpan | undefined {
  const trimmedFrom = skipSpaces(attrText, 0);
  const text = attrText.slice(trimmedFrom);
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;

  let pos = 1;
  while (pos < text.length - 1) {
    pos = skipSpaces(text, pos);
    if (pos >= text.length - 1) break;

    if (text[pos] === ".") {
      const next = readIdentifierEnd(text, pos + 1);
      if (next === pos + 1) return undefined;
      pos = next;
      continue;
    }

    if (text[pos] === "#") {
      const tokenStart = pos;
      const labelStart = pos + 1;
      const labelEnd = readIdentifierEnd(text, labelStart);
      if (labelEnd === labelStart) return undefined;
      if (text.slice(labelStart, labelEnd) === expectedId) {
        return {
          tokenFrom: absoluteFrom + trimmedFrom + tokenStart,
          tokenTo: absoluteFrom + trimmedFrom + labelEnd,
          labelFrom: absoluteFrom + trimmedFrom + labelStart,
          labelTo: absoluteFrom + trimmedFrom + labelEnd,
        };
      }
      pos = labelEnd;
      continue;
    }

    const keyEnd = readIdentifierEnd(text, pos);
    if (keyEnd === pos || keyEnd >= text.length || text[keyEnd] !== "=") {
      return undefined;
    }
    pos = skipAttributeValue(text, keyEnd + 1);
  }

  return undefined;
}

function findEquationLabelSpan(
  labelText: string,
  absoluteFrom: number,
  expectedId: string,
): TokenSpan | undefined {
  if (readBracedLabelId(labelText, 0, labelText.length) !== expectedId) {
    return undefined;
  }

  return {
    tokenFrom: absoluteFrom,
    tokenTo: absoluteFrom + labelText.length,
    labelFrom: absoluteFrom + 2,
    labelTo: absoluteFrom + 2 + expectedId.length,
  };
}

function findHeadingContentOffset(rawHeading: string): number {
  let pos = 0;
  while (pos < rawHeading.length && rawHeading[pos] === "#") {
    pos += 1;
  }
  while (pos < rawHeading.length && isSpaceTab(rawHeading.charCodeAt(pos))) {
    pos += 1;
  }
  return pos;
}

function findHeadingIdSpan(
  rawHeading: string,
  absoluteFrom: number,
  expectedId: string,
): TokenSpan | undefined {
  const contentOffset = findHeadingContentOffset(rawHeading);
  const content = rawHeading.slice(contentOffset);
  const attrs = findTrailingHeadingAttributes(content);
  if (!attrs) return undefined;

  const rawStart = skipSpaces(attrs.raw, 0);
  const attrOffset = contentOffset + attrs.index + rawStart;
  const attrText = attrs.raw.slice(rawStart);
  return findAttributeIdSpan(attrText, absoluteFrom + attrOffset, expectedId);
}

function buildDefinitionsById(
  definitions: readonly DocumentLabelDefinition[],
): ReadonlyMap<string, readonly DocumentLabelDefinition[]> {
  const byId = new Map<string, DocumentLabelDefinition[]>();
  for (const definition of definitions) {
    const bucket = byId.get(definition.id);
    if (bucket) {
      bucket.push(definition);
    } else {
      byId.set(definition.id, [definition]);
    }
  }
  return byId;
}

function buildUniqueDefinitionById(
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): ReadonlyMap<string, DocumentLabelDefinition> {
  const unique = new Map<string, DocumentLabelDefinition>();
  for (const [id, definitions] of definitionsById) {
    if (definitions.length === 1) {
      unique.set(id, definitions[0]);
    }
  }
  return unique;
}

function buildDuplicatesById(
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

function buildReferencesByTarget(
  references: readonly DocumentLabelReference[],
): ReadonlyMap<string, readonly DocumentLabelReference[]> {
  const byTarget = new Map<string, DocumentLabelReference[]>();
  for (const reference of references) {
    const bucket = byTarget.get(reference.id);
    if (bucket) {
      bucket.push(reference);
    } else {
      byTarget.set(reference.id, [reference]);
    }
  }
  return byTarget;
}

function buildHeadingDefinitions(
  catalog: DocumentReferenceCatalog,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions: DocumentLabelDefinition[] = [];

  for (const heading of catalog.targets) {
    if (heading.kind !== "heading" || !heading.id) continue;
    const span = findHeadingIdSpan(
      doc.sliceString(heading.from, heading.to),
      heading.from,
      heading.id,
    );
    if (!span) continue;
    definitions.push({
      id: heading.id,
      kind: "heading",
      from: heading.from,
      to: heading.to,
      tokenFrom: span.tokenFrom,
      tokenTo: span.tokenTo,
      labelFrom: span.labelFrom,
      labelTo: span.labelTo,
      displayLabel: heading.displayLabel,
      number: heading.number,
      title: heading.title,
    });
  }

  return definitions;
}

function buildEquationDefinitions(
  catalog: DocumentReferenceCatalog,
  analysis: DocumentAnalysis,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions: DocumentLabelDefinition[] = [];
  for (const equation of analysis.equations) {
    const target = catalog.targetsById.get(equation.id)
      ?.find((candidate) => candidate.kind === "equation" && candidate.from === equation.from)
      ?? catalog.targetsById.get(equation.id)
        ?.find((candidate) => candidate.kind === "equation");
    if (!target) continue;

    const span = findEquationLabelSpan(
      doc.sliceString(equation.labelFrom, equation.labelTo),
      equation.labelFrom,
      equation.id,
    );
    if (!span) continue;

    definitions.push({
      id: equation.id,
      kind: "equation",
      from: equation.from,
      to: equation.to,
      tokenFrom: span.tokenFrom,
      tokenTo: span.tokenTo,
      labelFrom: span.labelFrom,
      labelTo: span.labelTo,
      displayLabel: target.displayLabel,
      number: target.number,
      text: target.text,
    });
  }

  return definitions;
}

function buildBlockDefinitions(
  catalog: DocumentReferenceCatalog,
  analysis: DocumentAnalysis,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions: DocumentLabelDefinition[] = [];

  for (const block of catalog.targets) {
    if (block.kind !== "block" || !block.id) continue;
    const div = analysis.fencedDivByFrom.get(block.from);
    if (!div || div.attrFrom === undefined || div.attrTo === undefined) continue;

    const span = findAttributeIdSpan(
      doc.sliceString(div.attrFrom, div.attrTo),
      div.attrFrom,
      block.id,
    );
    if (!span) continue;

    definitions.push({
      id: block.id,
      kind: "block",
      blockType: block.blockType,
      from: block.from,
      to: block.to,
      tokenFrom: span.tokenFrom,
      tokenTo: span.tokenTo,
      labelFrom: span.labelFrom,
      labelTo: span.labelTo,
      displayLabel: block.displayLabel,
      number: block.number,
      title: block.title,
    });
  }

  return definitions;
}

function buildDefinitions(
  catalog: DocumentReferenceCatalog,
  analysis: DocumentAnalysis,
  doc: Text,
): DocumentLabelDefinition[] {
  const definitions = [
    ...buildHeadingDefinitions(catalog, doc),
    ...buildBlockDefinitions(catalog, analysis, doc),
    ...buildEquationDefinitions(catalog, analysis, doc),
  ];
  definitions.sort((a, b) => (a.from - b.from) || (a.to - b.to));
  return definitions;
}

function buildReferences(
  catalog: DocumentReferenceCatalog,
  doc: Text,
): DocumentLabelReference[] {
  const references: DocumentLabelReference[] = [];

  for (const ref of catalog.references) {
    if (!ref.bracketed) {
      const id = ref.ids[0];
      if (!id || !catalog.targetsById.has(id)) continue;
      references.push({
        id,
        from: ref.from,
        to: ref.to,
        labelFrom: ref.from + 1,
        labelTo: ref.from + 1 + id.length,
        clusterFrom: ref.from,
        clusterTo: ref.to,
        clusterIndex: 0,
        bracketed: false,
        locator: ref.locators[0],
      });
      continue;
    }

    const raw = doc.sliceString(ref.from, ref.to);
    let searchFrom = 0;
    for (let index = 0; index < ref.ids.length; index += 1) {
      const id = ref.ids[index];
      const span = findBracketedOccurrenceSpan(raw, ref.from, id, searchFrom);
      if (!span) continue;
      searchFrom = span.tokenTo - ref.from;
      if (!catalog.targetsById.has(id)) continue;

      references.push({
        id,
        from: span.tokenFrom,
        to: span.tokenTo,
        labelFrom: span.labelFrom,
        labelTo: span.labelTo,
        clusterFrom: ref.from,
        clusterTo: ref.to,
        clusterIndex: index,
        bracketed: true,
        locator: ref.locators[index],
      });
    }
  }

  return references;
}

function graphDependenciesChanged(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    tr.startState.field(documentAnalysisField) !== tr.state.field(documentAnalysisField) ||
    tr.startState.field(blockCounterField, false) !== tr.state.field(blockCounterField, false) ||
    tr.startState.field(pluginRegistryField, false) !== tr.state.field(pluginRegistryField, false)
  );
}

export function isValidDocumentLabelId(id: string): boolean {
  return LOCAL_LABEL_RE.test(id);
}

export function buildDocumentLabelGraph(state: EditorState): DocumentLabelGraph {
  const analysis = state.field(documentAnalysisField, false)
    ?? getDocumentAnalysisOrRecompute(state);
  const catalog = getEditorDocumentReferenceCatalog(state, analysis);
  const doc = state.doc;
  const definitions = buildDefinitions(catalog, analysis, doc);
  const definitionsById = buildDefinitionsById(definitions);
  const references = buildReferences(catalog, doc);

  return {
    definitions,
    definitionsById,
    uniqueDefinitionById: buildUniqueDefinitionById(definitionsById),
    duplicatesById: buildDuplicatesById(definitionsById),
    references,
    referencesByTarget: buildReferencesByTarget(references),
  };
}

export function getDocumentLabelDefinitions(
  graph: DocumentLabelGraph,
  id: string,
): readonly DocumentLabelDefinition[] {
  return graph.definitionsById.get(id) ?? EMPTY_DEFINITIONS;
}

export function getDocumentLabelDefinition(
  graph: DocumentLabelGraph,
  id: string,
): DocumentLabelDefinition | undefined {
  return graph.uniqueDefinitionById.get(id);
}

export function findDocumentLabelBacklinks(
  graph: DocumentLabelGraph,
  id: string,
): readonly DocumentLabelReference[] {
  return graph.referencesByTarget.get(id) ?? EMPTY_REFERENCES;
}

export function validateDocumentLabelRename(
  graph: DocumentLabelGraph,
  nextId: string,
  options: { currentId?: string } = {},
): DocumentLabelRenameValidation {
  const candidate = nextId.trim();
  if (candidate.length === 0) {
    return { ok: false, id: candidate, reason: "empty" };
  }

  if (candidate !== nextId || !isValidDocumentLabelId(candidate)) {
    return { ok: false, id: candidate, reason: "invalid-format" };
  }

  if (candidate === options.currentId) {
    return { ok: true, id: candidate };
  }

  const conflictingDefinitions = graph.definitionsById.get(candidate);
  if (conflictingDefinitions) {
    return {
      ok: false,
      id: candidate,
      reason: "collision",
      conflictingDefinitions,
    };
  }

  return { ok: true, id: candidate };
}

export const documentLabelGraphField = StateField.define<DocumentLabelGraph>({
  create(state) {
    return buildDocumentLabelGraph(state);
  },

  update(value, tr) {
    if (!graphDependenciesChanged(tr)) {
      return value;
    }
    return buildDocumentLabelGraph(tr.state);
  },
});
