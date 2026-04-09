import {
  type Annotation,
  type AnnotationType,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { FencedBlockInfo } from "../fenced-block/model";
import {
  type FenceChangeSpec,
  type FenceRange,
  collectFenceTransactionChanges,
  planEmptyMathBlockBackspaceCleanup,
  planFenceProtectionDecision,
  planOpeningFenceDeletionCleanup,
  shouldBlockClosingFenceChanges,
  shouldBlockOpeningFenceChanges,
} from "./fence-protection-pipeline";

type FenceRewrite = FenceChangeSpec | readonly FenceChangeSpec[];

interface FenceRewriteSpec {
  readonly changes: FenceRewrite;
  readonly annotations: Annotation<true>;
}

interface SharedFenceProtectionDeps {
  readonly shouldBypassFenceProtection: (tr: Transaction) => boolean;
  readonly annotateFenceRewrite: (changes: FenceRewrite) => FenceRewriteSpec;
}

interface OpeningFenceDeletionCleanupDeps extends SharedFenceProtectionDeps {
  readonly getAllFencedBlocks: (state: EditorState) => readonly FencedBlockInfo[];
}

interface ClosingFenceProtectionDeps extends SharedFenceProtectionDeps {
  readonly getClosingFenceRanges: (state: EditorState) => readonly FenceRange[];
}

interface OpeningFenceProtectionDeps extends SharedFenceProtectionDeps {
  readonly getRanges: (state: EditorState) => readonly FenceRange[];
  readonly kind: "colon" | "backtick" | "math";
}

interface FenceProtectionDecisionInputs {
  readonly allFencedBlocks: readonly FencedBlockInfo[];
  readonly closingFenceRanges: readonly FenceRange[];
  readonly openingFenceColonRanges: readonly FenceRange[];
  readonly openingFenceBacktickRanges: readonly FenceRange[];
  readonly openingMathDelimiterRanges: readonly FenceRange[];
}

interface FenceProtectionTransactionFilterDeps extends SharedFenceProtectionDeps {
  readonly getFenceProtectionDecisionInputs: (
    state: EditorState,
  ) => FenceProtectionDecisionInputs;
}

function createOpeningFenceProtection(deps: OpeningFenceProtectionDeps) {
  return EditorState.transactionFilter.of((tr) => {
    if (deps.shouldBypassFenceProtection(tr)) return tr;

    const blocked = shouldBlockOpeningFenceChanges(
      collectFenceTransactionChanges(tr),
      deps.getRanges(tr.startState),
      deps.kind,
    );
    return blocked ? [] : tr;
  });
}

export function createOpeningFenceDeletionCleanup(
  deps: OpeningFenceDeletionCleanupDeps,
) {
  return EditorState.transactionFilter.of((tr) => {
    if (deps.shouldBypassFenceProtection(tr)) return tr;

    const cleanup = planOpeningFenceDeletionCleanup(
      tr.startState,
      collectFenceTransactionChanges(tr),
      deps.getAllFencedBlocks(tr.startState),
    );
    return cleanup ? deps.annotateFenceRewrite(cleanup) : tr;
  });
}

export function createClosingFenceProtection(
  deps: ClosingFenceProtectionDeps,
) {
  return EditorState.transactionFilter.of((tr) => {
    if (deps.shouldBypassFenceProtection(tr)) return tr;

    const blocked = shouldBlockClosingFenceChanges(
      collectFenceTransactionChanges(tr),
      deps.getClosingFenceRanges(tr.startState),
      tr.startState.doc.length,
    );
    return blocked ? [] : tr;
  });
}

export function createOpeningFenceColonProtection(
  deps: Omit<OpeningFenceProtectionDeps, "kind" | "getRanges"> & {
    readonly getOpeningFenceColonRanges: (state: EditorState) => readonly FenceRange[];
  },
) {
  return createOpeningFenceProtection({
    ...deps,
    getRanges: deps.getOpeningFenceColonRanges,
    kind: "colon",
  });
}

export function createOpeningFenceBacktickProtection(
  deps: Omit<OpeningFenceProtectionDeps, "kind" | "getRanges"> & {
    readonly getOpeningFenceBacktickRanges: (state: EditorState) => readonly FenceRange[];
  },
) {
  return createOpeningFenceProtection({
    ...deps,
    getRanges: deps.getOpeningFenceBacktickRanges,
    kind: "backtick",
  });
}

export function createOpeningFenceMathProtection(
  deps: Omit<OpeningFenceProtectionDeps, "kind" | "getRanges"> & {
    readonly getOpeningMathDelimiterRanges: (state: EditorState) => readonly FenceRange[];
  },
) {
  return createOpeningFenceProtection({
    ...deps,
    getRanges: deps.getOpeningMathDelimiterRanges,
    kind: "math",
  });
}

export function createPairedMathEntry(
  fenceOperationAnnotation: AnnotationType<true>,
) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (from !== to) return false; // has selection

    const state = view.state;
    const line = state.doc.lineAt(from);

    if (text === "$") {
      // Check if completing $$ on a (possibly indented) otherwise-blank line.
      // `before` contains everything from line start to cursor; trim leading
      // whitespace so indented lines (e.g. inside a list) still match.
      const before = state.sliceDoc(line.from, from);
      const beforeTrimmed = before.trimStart();
      if (beforeTrimmed !== "$") return false;
      const after = state.sliceDoc(from, line.to).trim();
      if (after !== "") return false;

      // Bracket-match skip: don't auto-insert if next non-blank line is $$
      for (let n = line.number + 1; n <= state.doc.lines; n += 1) {
        const trimmed = state.doc.line(n).text.trim();
        if (trimmed === "") continue;
        if (trimmed === "$$") return false;
        break;
      }

      // Preserve indentation: keep the leading whitespace on all three lines.
      const indent = before.slice(0, before.length - beforeTrimmed.length);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: `${indent}$$\n\n${indent}$$` },
        selection: { anchor: line.from + indent.length + 3 },
        annotations: fenceOperationAnnotation.of(true),
      });
      return true;
    }

    if (text === "[") {
      // Check if completing \[ on a (possibly indented) otherwise-blank line.
      const before = state.sliceDoc(line.from, from);
      const beforeTrimmed = before.trimStart();
      if (beforeTrimmed !== "\\") return false;
      const after = state.sliceDoc(from, line.to).trim();
      if (after !== "") return false;

      // Bracket-match skip: don't auto-insert if next non-blank line is \]
      for (let n = line.number + 1; n <= state.doc.lines; n += 1) {
        const trimmed = state.doc.line(n).text.trim();
        if (trimmed === "") continue;
        if (trimmed === "\\]") return false;
        break;
      }

      // Preserve indentation: keep the leading whitespace on all three lines.
      const indent = before.slice(0, before.length - beforeTrimmed.length);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: `${indent}\\[\n\n${indent}\\]` },
        selection: { anchor: line.from + indent.length + 3 },
        annotations: fenceOperationAnnotation.of(true),
      });
      return true;
    }

    return false;
  });
}

export function createEmptyMathBlockBackspaceCleanup(
  deps: SharedFenceProtectionDeps,
) {
  return EditorState.transactionFilter.of((tr) => {
    if (deps.shouldBypassFenceProtection(tr)) return tr;

    const cleanup = planEmptyMathBlockBackspaceCleanup(
      tr.startState,
      collectFenceTransactionChanges(tr),
    );
    return cleanup ? deps.annotateFenceRewrite(cleanup) : tr;
  });
}

export function createFenceProtectionTransactionFilter(
  deps: FenceProtectionTransactionFilterDeps,
) {
  return EditorState.transactionFilter.of((tr) => {
    if (deps.shouldBypassFenceProtection(tr)) return tr;

    const state = tr.startState;
    const decision = planFenceProtectionDecision(
      state,
      collectFenceTransactionChanges(tr),
      deps.getFenceProtectionDecisionInputs(state),
    );

    if (decision.kind === "block") return [];
    if (decision.kind === "rewrite") return deps.annotateFenceRewrite(decision.changes);
    return tr;
  });
}
