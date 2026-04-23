import type { EditorState } from "@codemirror/state";
import type { ChangeChecker } from "../../state/change-detection";
import { createChangeChecker } from "../../state/change-detection";
import { bibDataField } from "../../state/bib-data";
import { blockCounterField } from "../../state/block-counter";
import { documentSemanticsField } from "../../state/document-analysis";
import type { HeadingEntry } from "../heading-ancestry";

export interface HeadingSidebarMetadata {
  readonly level: number;
  readonly text: string;
  readonly number: string;
}

interface ReferenceSidebarMetadata {
  readonly bracketed: boolean;
  readonly ids: readonly string[];
}

function sameStringArray(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return before.length === after.length
    && before.every((value, index) => value === after[index]);
}

function sameReferenceSidebarMetadata(
  before: readonly ReferenceSidebarMetadata[],
  after: readonly ReferenceSidebarMetadata[],
): boolean {
  return before.length === after.length
    && before.every((value, index) => (
      value.bracketed === after[index]?.bracketed
      && sameStringArray(value.ids, after[index]?.ids ?? [])
    ));
}

export function createHeadingSidebarMetadata(
  headings: readonly HeadingEntry[],
): readonly HeadingSidebarMetadata[] {
  return headings.map((heading) => ({
    level: heading.level,
    text: heading.text,
    number: heading.number,
  }));
}

export function sameHeadingSidebarMetadata(
  before: readonly HeadingSidebarMetadata[],
  after: readonly HeadingSidebarMetadata[],
): boolean {
  return before.length === after.length
    && before.every((value, index) => (
      value.level === after[index]?.level
      && value.text === after[index]?.text
      && value.number === after[index]?.number
    ));
}

function selectReferenceSidebarMetadata(state: EditorState): readonly ReferenceSidebarMetadata[] {
  const analysis = state.field(documentSemanticsField);
  return analysis.references.map((reference) => ({
    bracketed: reference.bracketed,
    ids: [...reference.ids],
  }));
}

function selectHeadingIdMetadata(state: EditorState): readonly string[] {
  const analysis = state.field(documentSemanticsField);
  return analysis.headings.map((heading) => heading.id ?? "");
}

function selectEquationIdMetadata(state: EditorState): readonly string[] {
  const analysis = state.field(documentSemanticsField);
  return analysis.equations.map((equation) => equation.id);
}

function selectBlockIdMetadata(state: EditorState): readonly string[] {
  return (state.field(blockCounterField, false)?.blocks ?? []).map((block) => block.id ?? "");
}

function selectBibliographyIdMetadata(state: EditorState): readonly string[] {
  return [...(state.field(bibDataField, false)?.store.keys() ?? [])].sort();
}

export function createDiagnosticsSidebarChangeChecker(): ChangeChecker {
  return createChangeChecker(
    {
      get: selectReferenceSidebarMetadata,
      equals: sameReferenceSidebarMetadata,
    },
    {
      get: selectHeadingIdMetadata,
      equals: sameStringArray,
    },
    {
      get: selectEquationIdMetadata,
      equals: sameStringArray,
    },
    {
      get: selectBlockIdMetadata,
      equals: sameStringArray,
    },
    {
      get: selectBibliographyIdMetadata,
      equals: sameStringArray,
    },
    (state) => state.field(bibDataField, false)?.processorRevision ?? 0,
  );
}
