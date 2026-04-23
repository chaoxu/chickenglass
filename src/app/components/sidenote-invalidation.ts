import type { EditorState } from "@codemirror/state";
import { documentSemanticsField } from "../../state/document-analysis";
import { mathMacrosField } from "../../state/math-macros";
import { serializeMacros } from "../../render/render-core";
import type { SidenoteInvalidation } from "./sidenote-margin";

const EMPTY_MACROS: Record<string, string> = {};

interface FootnoteRefLike {
  readonly from?: number;
}

interface FootnoteSemanticsLike {
  readonly refs?: readonly FootnoteRefLike[];
}

interface DocumentSemanticsLike {
  readonly footnotes?: FootnoteSemanticsLike;
}

interface ChangedRangesLike {
  iterChangedRanges(
    callback: (fromA: number, toA: number, fromB: number, toB: number) => void,
  ): void;
}

export interface SidenoteInvalidationUpdateLike {
  readonly startState: EditorState;
  readonly state: EditorState;
  readonly heightChanged: boolean;
  readonly docChanged?: boolean;
  readonly changes?: ChangedRangesLike;
}

function getEarliestChangedPosition(update: SidenoteInvalidationUpdateLike): number {
  if (!update.docChanged || !update.changes) {
    return -1;
  }

  let earliestChangedFrom = -1;
  update.changes.iterChangedRanges((_fromA, _toA, fromB) => {
    if (earliestChangedFrom === -1 || fromB < earliestChangedFrom) {
      earliestChangedFrom = fromB;
    }
  });
  return earliestChangedFrom;
}

function hasAffectedFootnoteRefs(
  semantics: DocumentSemanticsLike | undefined,
  layoutChangeFrom: number,
): boolean {
  if (layoutChangeFrom < 0) {
    return false;
  }

  const refs = semantics?.footnotes?.refs ?? [];
  return refs.some((ref) => typeof ref.from === "number" && ref.from >= layoutChangeFrom);
}

export function computeSidenoteInvalidation(
  update: SidenoteInvalidationUpdateLike,
): Omit<SidenoteInvalidation, "revision"> | null {
  const beforeAnalysis = update.startState.field(documentSemanticsField, false) as
    | DocumentSemanticsLike
    | undefined;
  const afterAnalysis = update.state.field(documentSemanticsField, false) as
    | DocumentSemanticsLike
    | undefined;
  if (!afterAnalysis) {
    return null;
  }

  const footnotesChanged = beforeAnalysis?.footnotes !== afterAnalysis.footnotes;
  const beforeMacros =
    (update.startState.field(mathMacrosField, false) as Record<string, string> | undefined)
    ?? EMPTY_MACROS;
  const afterMacros =
    (update.state.field(mathMacrosField, false) as Record<string, string> | undefined)
    ?? EMPTY_MACROS;
  const macrosChanged = beforeMacros !== afterMacros
    && serializeMacros(beforeMacros) !== serializeMacros(afterMacros);
  const layoutChangeFrom = getEarliestChangedPosition(update);
  const docLayoutChanged = hasAffectedFootnoteRefs(afterAnalysis, layoutChangeFrom);
  const globalLayoutChanged = update.heightChanged;

  if (!footnotesChanged && !macrosChanged && !globalLayoutChanged && !docLayoutChanged) {
    return null;
  }

  return {
    footnotesChanged,
    macrosChanged,
    globalLayoutChanged,
    layoutChangeFrom: docLayoutChanged ? layoutChangeFrom : -1,
  };
}
