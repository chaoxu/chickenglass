import {
  type EditorState,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import {
  collectFencedDivs,
  type FencedDivInfo,
  findFencedBlockAt,
  getFencedDivRevealFrom,
  getFencedDivRevealTo,
} from "../fenced-block/model";
import { containsPos, containsRange } from "../lib/range-helpers";
import type {
  FootnoteDefinition,
} from "../semantics/document";
import { documentAnalysisField } from "./document-analysis";
import { focusEffect } from "./editor-focus";
import { frontmatterField } from "./frontmatter-state";
import { programmaticDocumentChangeAnnotation } from "./programmatic-document-change";
import { findCodeShellAt } from "./shell-ownership";
import type {
  CodeFenceStructureEditTarget,
  DisplayMathStructureEditTarget,
  FencedStructureEditTarget,
  FootnoteLabelStructureEditTarget,
  FrontmatterStructureEditTarget,
  StructureEditTarget,
} from "../lib/debug-types";
export type {
  CodeFenceStructureEditTarget,
  DisplayMathStructureEditTarget,
  FencedStructureEditTarget,
  FootnoteLabelStructureEditTarget,
  FrontmatterStructureEditTarget,
  StructureEditTarget,
} from "../lib/debug-types";

export const setStructureEditTargetEffect =
  StateEffect.define<StructureEditTarget | null>();

export function hasStructureEditEffect(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(setStructureEditTargetEffect));
}

function fencedTargetFromDiv(div: FencedDivInfo): FencedStructureEditTarget {
  return {
    kind: "fenced-opener",
    openFenceFrom: div.openFenceFrom,
    editFrom: div.openFenceFrom,
    editTo: getFencedDivRevealTo(div),
    revealFrom: getFencedDivRevealFrom(div),
    revealTo: getFencedDivRevealTo(div),
    className: div.className,
    title: div.title ?? null,
  };
}

function findInnermostFencedDivAt(
  state: EditorState,
  pos: number,
): FencedDivInfo | null {
  const divs = collectFencedDivs(state).filter((div) => containsPos(div, pos));
  if (divs.length === 0) return null;
  divs.sort((left, right) => {
    const leftSpan = left.to - left.from;
    const rightSpan = right.to - right.from;
    return leftSpan - rightSpan || left.from - right.from;
  });
  return divs[0];
}

function fencedDivStructureContainsPos(div: FencedDivInfo, pos: number): boolean {
  return containsPos(
    { from: getFencedDivRevealFrom(div), to: getFencedDivRevealTo(div) },
    pos,
  );
}

function findInnermostFencedDivStructureAt(
  state: EditorState,
  pos: number,
): FencedDivInfo | null {
  const divs = collectFencedDivs(state).filter((div) =>
    fencedDivStructureContainsPos(div, pos)
  );
  if (divs.length === 0) return null;
  divs.sort((left, right) => {
    const leftSpan = getFencedDivRevealTo(left) - getFencedDivRevealFrom(left);
    const rightSpan = getFencedDivRevealTo(right) - getFencedDivRevealFrom(right);
    return leftSpan - rightSpan || left.from - right.from;
  });
  return divs[0];
}

function frontmatterTargetFromState(
  state: EditorState,
): FrontmatterStructureEditTarget | null {
  const frontmatter = state.field(frontmatterField, false);
  if (!frontmatter || frontmatter.end <= 0) return null;
  return {
    kind: "frontmatter",
    from: 0,
    to: frontmatter.end,
    title: frontmatter.config.title ?? null,
  };
}

function createCodeFenceStructureEditTargetAt(
  state: EditorState,
  pos: number,
): CodeFenceStructureEditTarget | null {
  const codeBlock = findCodeShellAt(state, pos);
  return codeBlock
    ? {
        kind: "code-fence",
        ...codeBlock,
      }
    : null;
}

function createFootnoteLabelStructureEditTargetAt(
  state: EditorState,
  pos: number,
): FootnoteLabelStructureEditTarget | null {
  const analysis = state.field(documentAnalysisField, false);
  if (!analysis) return null;
  const definition = analysis.footnotes.defByFrom;
  for (const def of definition.values()) {
    if (containsPos({ from: def.from, to: def.labelTo }, pos)) {
      return {
        kind: "footnote-label",
        id: def.id,
        from: def.from,
        to: def.to,
        labelFrom: def.labelFrom,
        labelTo: def.labelTo,
      };
    }
  }
  return null;
}

function createDisplayMathStructureEditTargetAt(
  state: EditorState,
  pos: number,
): DisplayMathStructureEditTarget | null {
  const analysis = state.field(documentAnalysisField, false);
  if (!analysis) return null;
  const regions = analysis.mathRegions;
  const posLine = state.doc.lineAt(pos).number;
  for (const region of regions) {
    if (!region.isDisplay) continue;
    const regionStartLine = state.doc.lineAt(region.from).number;
    const regionEndLine = state.doc.lineAt(region.to).number;
    if (containsPos(region, pos) || (posLine >= regionStartLine && posLine <= regionEndLine)) {
      return {
        kind: "display-math",
        from: region.from,
        to: region.to,
        contentFrom: region.contentFrom,
        contentTo: region.contentTo,
      };
    }
  }
  return null;
}

function mapStructureEditTarget(
  target: StructureEditTarget,
  state: EditorState,
  mapPos: (pos: number, assoc?: number) => number,
): StructureEditTarget | null {
  if (target.kind === "frontmatter") {
    return frontmatterTargetFromState(state);
  }

  if (target.kind === "code-fence") {
    const mappedOpenFenceFrom = mapPos(target.openFenceFrom, 1);
    return createCodeFenceStructureEditTargetAt(state, mappedOpenFenceFrom);
  }

  if (target.kind === "footnote-label") {
    const mappedLabelFrom = mapPos(target.labelFrom, 1);
    return createFootnoteLabelStructureEditTargetAt(state, mappedLabelFrom);
  }

  if (target.kind === "display-math") {
    const mappedFrom = mapPos(target.from, 1);
    const remapped = createDisplayMathStructureEditTargetAt(state, mappedFrom);
    if (remapped) return remapped;
    const mappedTo = Math.max(mappedFrom, mapPos(target.to, -1));
    const mappedContentFrom = Math.max(mappedFrom, mapPos(target.contentFrom, 1));
    const mappedContentTo = Math.max(mappedContentFrom, mapPos(target.contentTo, -1));
    return {
      kind: "display-math",
      from: mappedFrom,
      to: mappedTo,
      contentFrom: mappedContentFrom,
      contentTo: mappedContentTo,
    };
  }

  const mappedOpenFenceFrom = mapPos(target.openFenceFrom, 1);
  const divs = collectFencedDivs(state);
  const div = divs.find(
    (candidate) => candidate.openFenceFrom === mappedOpenFenceFrom,
  ) ?? findFencedBlockAt(divs, mappedOpenFenceFrom);
  return div ? fencedTargetFromDiv(div) : null;
}

function selectionWithinStructureTarget(
  target: StructureEditTarget,
  from: number,
  to: number,
): boolean {
  const selection = { from, to };
  if (target.kind === "frontmatter") {
    return containsRange(target, selection);
  }
  if (target.kind === "code-fence") {
    return containsRange(
      { from: target.openFenceFrom, to: target.openFenceTo },
      selection,
    );
  }
  if (target.kind === "footnote-label") {
    return containsRange(
      { from: target.labelFrom, to: target.labelTo },
      selection,
    );
  }
  if (target.kind === "display-math") {
    return containsRange(target, selection);
  }
  return containsRange({ from: target.editFrom, to: target.editTo }, selection);
}

function transactionBlurred(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(focusEffect) && !effect.value);
}

function transactionReplacedDocument(tr: Transaction): boolean {
  return tr.annotation(programmaticDocumentChangeAnnotation) === true;
}

export const activeStructureEditField =
  StateField.define<StructureEditTarget | null>({
    create() {
      return null;
    },
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setStructureEditTargetEffect)) {
          const target = effect.value;
          if (!target) return null;
          return mapStructureEditTarget(target, tr.state, (pos) => pos);
        }
      }

      let nextValue = value;
      if (nextValue && tr.docChanged) {
        if (transactionReplacedDocument(tr)) {
          return null;
        }
        nextValue = mapStructureEditTarget(
          nextValue,
          tr.state,
          tr.changes.mapPos.bind(tr.changes),
        );
      }
      if (!nextValue) return null;

      if (transactionBlurred(tr)) {
        return null;
      }

      if (
        tr.selection &&
        !selectionWithinStructureTarget(
          nextValue,
          tr.state.selection.main.from,
          tr.state.selection.main.to,
        )
      ) {
        return null;
      }

      return nextValue;
    },
  });

export function getActiveStructureEditTarget(
  state: EditorState,
): StructureEditTarget | null {
  return state.field(activeStructureEditField, false) ?? null;
}

export function createFencedStructureEditTarget(
  state: EditorState,
  pos: number,
): StructureEditTarget | null {
  const div = findInnermostFencedDivAt(state, pos);
  return div ? fencedTargetFromDiv(div) : null;
}

export function createStructureEditTargetAt(
  state: EditorState,
  pos: number,
): StructureEditTarget | null {
  if (typeof state?.field !== "function") return null;
  const frontmatter = frontmatterTargetFromState(state);
  if (frontmatter && pos < frontmatter.to) {
    return frontmatter;
  }
  const candidates: StructureEditTarget[] = [];
  const fencedDiv = findInnermostFencedDivStructureAt(state, pos);
  if (fencedDiv) candidates.push(fencedTargetFromDiv(fencedDiv));
  const codeFence = createCodeFenceStructureEditTargetAt(state, pos);
  if (codeFence) candidates.push(codeFence);
  const footnoteLabel = createFootnoteLabelStructureEditTargetAt(state, pos);
  if (footnoteLabel) candidates.push(footnoteLabel);
  const displayMath = createDisplayMathStructureEditTargetAt(state, pos);
  if (displayMath) candidates.push(displayMath);
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => {
    const leftContains = structureEditTargetContainsPos(left, pos);
    const rightContains = structureEditTargetContainsPos(right, pos);
    if (leftContains !== rightContains) {
      return leftContains ? -1 : 1;
    }
    const leftSpan = structureTargetTo(left) - structureTargetFrom(left);
    const rightSpan = structureTargetTo(right) - structureTargetFrom(right);
    return leftSpan - rightSpan || structureTargetFrom(left) - structureTargetFrom(right);
  });
  return candidates[0];
}

function structureTargetFrom(target: StructureEditTarget): number {
  if (target.kind === "frontmatter") return target.from;
  if (target.kind === "fenced-opener") return target.editFrom;
  if (target.kind === "code-fence") return target.openFenceFrom;
  if (target.kind === "footnote-label") return target.labelFrom;
  return target.from;
}

function structureTargetTo(target: StructureEditTarget): number {
  if (target.kind === "frontmatter") return target.to;
  if (target.kind === "fenced-opener") return target.editTo;
  if (target.kind === "code-fence") return target.openFenceTo;
  if (target.kind === "footnote-label") return target.labelTo;
  return target.to;
}

export function structureEditTargetContainsPos(
  target: StructureEditTarget,
  pos: number,
): boolean {
  return containsPos(
    { from: structureTargetFrom(target), to: structureTargetTo(target) },
    pos,
  );
}

export function activateStructureEditTarget(
  view: EditorView,
  target: StructureEditTarget | null,
  selectionAnchor?: number,
): boolean {
  if (!target) return false;
  view.dispatch({
    effects: setStructureEditTargetEffect.of(target),
    selection: selectionAnchor === undefined ? undefined : { anchor: selectionAnchor },
    scrollIntoView: selectionAnchor === undefined ? undefined : false,
  });
  return true;
}

export function activateStructureEditAt(
  view: EditorView,
  pos: number,
): boolean {
  const target = createStructureEditTargetAt(view.state, pos);
  if (!target) return false;
  const selectionAnchor = target.kind === "frontmatter"
    ? 0
      : target.kind === "footnote-label"
        ? target.labelFrom
      : target.kind === "code-fence"
        ? target.openFenceFrom
      : target.kind === "display-math"
        ? target.contentFrom
        : Math.max(target.editFrom, Math.min(pos, target.editTo));
  return activateStructureEditTarget(view, target, selectionAnchor);
}

export function activateFrontmatterStructureEdit(view: EditorView): boolean {
  return activateStructureEditTarget(
    view,
    frontmatterTargetFromState(view.state),
    0,
  );
}

export function clearStructureEditTarget(view: EditorView): boolean {
  const active = getActiveStructureEditTarget(view.state);
  if (!active) return false;
  view.dispatch({
    effects: setStructureEditTargetEffect.of(null),
  });
  return true;
}

export function isFencedStructureEditActive(
  state: EditorState,
  div: Pick<FencedDivInfo, "openFenceFrom">,
): boolean {
  const active = getActiveStructureEditTarget(state);
  return (
    active?.kind === "fenced-opener" &&
    active.openFenceFrom === div.openFenceFrom
  );
}

export function isFencedStructureSourceEditActive(
  state: EditorState,
  div: Pick<FencedDivInfo, "openFenceFrom">,
): boolean {
  const active = getActiveStructureEditTarget(state);
  return (
    active?.kind === "fenced-opener" &&
    active.openFenceFrom === div.openFenceFrom &&
    selectionWithinStructureTarget(
      active,
      state.selection.main.from,
      state.selection.main.to,
    )
  );
}

export function isFrontmatterStructureEditActive(
  state: EditorState,
): boolean {
  return getActiveStructureEditTarget(state)?.kind === "frontmatter";
}

export function isCodeFenceStructureEditActive(
  state: EditorState,
  block: Pick<CodeFenceStructureEditTarget, "openFenceFrom">,
): boolean {
  const active = getActiveStructureEditTarget(state);
  return (
    active?.kind === "code-fence" &&
    active.openFenceFrom === block.openFenceFrom
  );
}

export function isFootnoteLabelStructureEditActive(
  state: EditorState,
  def: Pick<FootnoteDefinition, "labelFrom">,
): boolean {
  const active = getActiveStructureEditTarget(state);
  return (
    active?.kind === "footnote-label" &&
    active.labelFrom === def.labelFrom
  );
}
