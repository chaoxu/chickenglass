import {
  type Annotation,
  EditorState,
  type Transaction,
} from "@codemirror/state";
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

interface BypassFenceProtectionDeps {
  readonly shouldBypassFenceProtection: (tr: Transaction) => boolean;
}

interface RewriteFenceProtectionDeps extends BypassFenceProtectionDeps {
  readonly annotateFenceRewrite: (changes: FenceRewrite) => FenceRewriteSpec;
}

interface OpeningFenceDeletionCleanupDeps extends RewriteFenceProtectionDeps {
  readonly getAllFencedBlocks: (state: EditorState) => readonly FencedBlockInfo[];
}

interface ClosingFenceProtectionDeps extends BypassFenceProtectionDeps {
  readonly getClosingFenceRanges: (state: EditorState) => readonly FenceRange[];
}

interface OpeningFenceProtectionDeps extends BypassFenceProtectionDeps {
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

interface FenceProtectionTransactionFilterDeps extends RewriteFenceProtectionDeps {
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

export function createEmptyMathBlockBackspaceCleanup(
  deps: RewriteFenceProtectionDeps,
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
