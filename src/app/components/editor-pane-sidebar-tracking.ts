import type { EditorState } from "@codemirror/state";
import type { ChangeChecker } from "../../state/change-detection";
import { createChangeChecker } from "../../state/change-detection";
import { bibDataField } from "../../state/bib-data";
import { blockCounterField } from "../../state/block-counter";
import { documentSemanticsField } from "../../state/document-analysis";
import { frontmatterField } from "../../state/frontmatter-state";
import { mathMacrosField } from "../../state/math-macros";
import { projectConfigStatusFacet } from "../../project-config";
import { serializeMacros } from "../../render/render-core";
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

interface DiagnosticsSidebarMetadata {
  readonly bibliographyIds: readonly string[];
  readonly bibliographyStatus: string;
  readonly blockIds: readonly string[];
  readonly equationIds: readonly string[];
  readonly frontmatterStatus: string;
  readonly headingIds: readonly string[];
  readonly mathMacros: string;
  readonly mathRegions: readonly string[];
  readonly processorRevision: number;
  readonly projectConfigStatus: string;
  readonly references: readonly ReferenceSidebarMetadata[];
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

function selectMathRegionMetadata(state: EditorState): readonly string[] {
  const analysis = state.field(documentSemanticsField);
  return analysis.mathRegions.map((region) =>
    `${region.isDisplay ? "D" : "I"}:${region.latex}`
  );
}

function selectMathMacroMetadata(state: EditorState): string {
  return serializeMacros(state.field(mathMacrosField, false) ?? {});
}

function selectBlockIdMetadata(state: EditorState): readonly string[] {
  return (state.field(blockCounterField, false)?.blocks ?? []).map((block) => block.id ?? "");
}

function selectBibliographyIdMetadata(state: EditorState): readonly string[] {
  return [...(state.field(bibDataField, false)?.store.keys() ?? [])].sort();
}

function selectFrontmatterStatusMetadata(state: EditorState): string {
  const status = state.field(frontmatterField, false)?.status;
  return status ? JSON.stringify(status) : "";
}

function selectProjectConfigStatusMetadata(state: EditorState): string {
  return JSON.stringify(state.facet(projectConfigStatusFacet));
}

function selectBibliographyStatusMetadata(state: EditorState): string {
  const status = state.field(bibDataField, false)?.status;
  return status ? JSON.stringify(status) : "";
}

export function createDiagnosticsSidebarMetadata(
  state: EditorState,
): DiagnosticsSidebarMetadata {
  return {
    bibliographyIds: selectBibliographyIdMetadata(state),
    bibliographyStatus: selectBibliographyStatusMetadata(state),
    blockIds: selectBlockIdMetadata(state),
    equationIds: selectEquationIdMetadata(state),
    frontmatterStatus: selectFrontmatterStatusMetadata(state),
    headingIds: selectHeadingIdMetadata(state),
    mathMacros: selectMathMacroMetadata(state),
    mathRegions: selectMathRegionMetadata(state),
    processorRevision: state.field(bibDataField, false)?.processorRevision ?? 0,
    projectConfigStatus: selectProjectConfigStatusMetadata(state),
    references: selectReferenceSidebarMetadata(state),
  };
}

export function diagnosticsSidebarMetadataKey(state: EditorState): string {
  return JSON.stringify(createDiagnosticsSidebarMetadata(state));
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
      get: selectMathRegionMetadata,
      equals: sameStringArray,
    },
    {
      get: selectMathMacroMetadata,
      equals: (before, after) => before === after,
    },
    {
      get: selectBlockIdMetadata,
      equals: sameStringArray,
    },
    {
      get: selectBibliographyIdMetadata,
      equals: sameStringArray,
    },
    {
      get: selectFrontmatterStatusMetadata,
      equals: (before, after) => before === after,
    },
    {
      get: selectProjectConfigStatusMetadata,
      equals: (before, after) => before === after,
    },
    {
      get: selectBibliographyStatusMetadata,
      equals: (before, after) => before === after,
    },
    (state) => state.field(bibDataField, false)?.processorRevision ?? 0,
  );
}
