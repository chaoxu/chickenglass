import type {
  EditorState,
  Text,
  Transaction,
} from "@codemirror/state";
import type {
  FencedBlockInfo,
} from "../fenced-block/model";
import { countColons } from "../parser";
import { forEachOverlappingOrderedRange } from "../lib/range-helpers";

export interface FenceRange {
  readonly from: number;
  readonly to: number;
}

export interface FenceProtectionPolicy {
  readonly allFencedBlocks: readonly FencedBlockInfo[];
  readonly closingFenceRanges: readonly FenceRange[];
  readonly openingFenceColonRanges: readonly FenceRange[];
  readonly openingFenceBacktickRanges: readonly FenceRange[];
  readonly openingMathDelimiterRanges: readonly FenceRange[];
}

export interface FenceTransactionChange {
  readonly from: number;
  readonly to: number;
  readonly inserted: Text;
  readonly insertedLength: number;
}

export interface FenceChangeSpec {
  from: number;
  to: number;
  insert: string;
}

type OpeningFenceKind = "colon" | "backtick" | "math";

export type FenceProtectionDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "block" }
  | {
    readonly kind: "rewrite";
    readonly changes: FenceChangeSpec | readonly FenceChangeSpec[];
  };

const allowDecision: FenceProtectionDecision = { kind: "allow" };
const blockDecision: FenceProtectionDecision = { kind: "block" };

export function collectFenceTransactionChanges(
  tr: Transaction,
): readonly FenceTransactionChange[] {
  const changes: FenceTransactionChange[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({
      from: fromA,
      to: toA,
      inserted,
      insertedLength: inserted.length,
    });
  });
  return changes;
}

function isClosingFenceChangeBlocked(
  change: FenceTransactionChange,
  range: FenceRange,
  docLength: number,
): boolean {
  if (change.from > range.to || change.to < range.from) return false;
  if (
    change.insertedLength > 0
    && change.from === change.to
    && change.from === range.to
  ) {
    return false;
  }

  const extendsBeforeFence = change.from < range.from - 1 || change.from === 0;
  const extendsAfterFence = change.to >= range.to + 1 || change.to >= docLength;
  if (extendsBeforeFence && extendsAfterFence) return false;
  if (change.insertedLength > 0 && extendsBeforeFence) return false;
  return true;
}

export function shouldBlockClosingFenceChanges(
  changes: readonly FenceTransactionChange[],
  ranges: readonly FenceRange[],
  docLength: number,
): boolean {
  for (const change of changes) {
    let blocked = false;
    forEachOverlappingOrderedRange(ranges, change, (range) => {
      if (blocked) return;
      if (isClosingFenceChangeBlocked(change, range, docLength)) {
        blocked = true;
      }
    });
    if (blocked) return true;
  }
  return false;
}

function isOpeningFenceChangeBlocked(
  change: FenceTransactionChange,
  range: FenceRange,
  kind: OpeningFenceKind,
): boolean {
  if (change.from > range.to || change.to < range.from) return false;
  if (change.from === change.to) return false;
  if (change.from >= range.to) return false;

  const atOrBeforeStart = change.from <= range.from;
  const pastProtectedEnd = kind === "math"
    ? change.to >= range.to
    : change.to > range.to;
  if (atOrBeforeStart && pastProtectedEnd) return false;
  if (change.insertedLength > 0 && change.from < range.from) return false;
  return true;
}

export function shouldBlockOpeningFenceChanges(
  changes: readonly FenceTransactionChange[],
  ranges: readonly FenceRange[],
  kind: OpeningFenceKind,
): boolean {
  for (const change of changes) {
    let blocked = false;
    forEachOverlappingOrderedRange(ranges, change, (range) => {
      if (blocked) return;
      if (isOpeningFenceChangeBlocked(change, range, kind)) {
        blocked = true;
      }
    });
    if (blocked) return true;
  }
  return false;
}

function getOpeningFencePrefixRange(
  state: EditorState,
  block: FencedBlockInfo,
): FenceRange | null {
  const rawText = state.sliceDoc(block.openFenceFrom, block.openFenceTo);
  const indent = rawText.length - rawText.trimStart().length;
  const prefixStart = block.openFenceFrom + indent;
  const text = indent > 0 ? rawText.substring(indent) : rawText;
  const firstChar = text.charAt(0);

  if (firstChar === ":") {
    const colonLength = countColons(text, 0);
    if (colonLength >= 3) {
      return { from: prefixStart, to: prefixStart + colonLength };
    }
    return null;
  }

  if (firstChar === "`") {
    const match = /^`{3,}/.exec(text);
    if (match) {
      return { from: prefixStart, to: prefixStart + match[0].length };
    }
    return null;
  }

  if (firstChar === "$" && text.startsWith("$$")) {
    return { from: prefixStart, to: prefixStart + 2 };
  }

  if (firstChar === "\\" && text.startsWith("\\[")) {
    return { from: prefixStart, to: prefixStart + 2 };
  }

  return null;
}

function mergeCleanupChanges(
  changes: readonly FenceTransactionChange[],
  cleanupDeletes: readonly FenceChangeSpec[],
): readonly FenceChangeSpec[] {
  const merged: FenceChangeSpec[] = changes.map((change) => ({
    from: change.from,
    to: change.to,
    insert: change.inserted.toString(),
  }));
  merged.push(...cleanupDeletes);
  merged.sort((left, right) => left.from - right.from || left.to - right.to);

  const compacted: FenceChangeSpec[] = [];
  for (const change of merged) {
    const previous = compacted.length > 0 ? compacted[compacted.length - 1] : null;
    if (
      previous
      && previous.insert === ""
      && change.insert === ""
      && change.from <= previous.to
    ) {
      previous.to = Math.max(previous.to, change.to);
      continue;
    }
    compacted.push({ ...change });
  }

  return compacted;
}

export function planOpeningFenceDeletionCleanup(
  state: EditorState,
  changes: readonly FenceTransactionChange[],
  blocks: readonly FencedBlockInfo[],
): readonly FenceChangeSpec[] | null {
  if (blocks.length === 0) return null;
  if (changes.every((change) => change.from === change.to)) return null;

  const closingFencesToRemove: FenceChangeSpec[] = [];
  for (const change of changes) {
    if (change.insertedLength > 1) continue;

    for (const block of blocks) {
      if (block.singleLine || block.closeFenceFrom < 0) continue;

      const openLine = state.doc.lineAt(block.openFenceFrom);
      const fullLineDeletion = change.from <= openLine.from && change.to >= openLine.to;

      let prefixBroken = false;
      if (!fullLineDeletion) {
        const prefix = getOpeningFencePrefixRange(state, block);
        if (prefix && change.from <= prefix.from && change.to >= prefix.to) {
          prefixBroken = true;
        }
      }

      if (!fullLineDeletion && !prefixBroken) continue;
      if (change.from <= block.closeFenceFrom && change.to >= block.closeFenceTo) continue;

      const closeLine = state.doc.lineAt(block.closeFenceFrom);
      const removeFrom = closeLine.from > 0 ? closeLine.from - 1 : closeLine.from;
      const removeTo = closeLine.to < state.doc.length ? closeLine.to + 1 : closeLine.to;
      closingFencesToRemove.push({ from: removeFrom, to: removeTo, insert: "" });
    }
  }

  if (closingFencesToRemove.length === 0) return null;
  return mergeCleanupChanges(changes, closingFencesToRemove);
}

export function planEmptyMathBlockBackspaceCleanup(
  state: EditorState,
  changes: readonly FenceTransactionChange[],
): FenceChangeSpec | null {
  if (changes.length !== 1) return null;

  const change = changes[0];
  if (change.insertedLength !== 0 || change.to - change.from !== 1) return null;

  const openLine = state.doc.lineAt(change.from);
  const openText = openLine.text.trim();

  let closingDelimiter: string;
  if (openText === "$$") closingDelimiter = "$$";
  else if (openText === "\\[") closingDelimiter = "\\]";
  else return null;

  if (change.to <= openLine.to) return null;

  const contentLine = state.doc.lineAt(change.to);
  if (contentLine.text.trim() !== "") return null;

  let closingLine: { from: number; to: number } | null = null;
  for (let number = contentLine.number; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const trimmed = line.text.trim();
    if (trimmed === "") continue;
    if (trimmed === closingDelimiter) closingLine = { from: line.from, to: line.to };
    break;
  }
  if (!closingLine) return null;

  let removeFrom = openLine.from;
  let removeTo = closingLine.to;
  if (removeTo < state.doc.length) removeTo += 1;
  else if (removeFrom > 0) removeFrom -= 1;

  return { from: removeFrom, to: removeTo, insert: "" };
}

export function planFenceProtectionDecision(
  state: EditorState,
  changes: readonly FenceTransactionChange[],
  policy: FenceProtectionPolicy,
): FenceProtectionDecision {
  if (
    shouldBlockClosingFenceChanges(changes, policy.closingFenceRanges, state.doc.length)
    || shouldBlockOpeningFenceChanges(changes, policy.openingFenceColonRanges, "colon")
    || shouldBlockOpeningFenceChanges(changes, policy.openingFenceBacktickRanges, "backtick")
    || shouldBlockOpeningFenceChanges(changes, policy.openingMathDelimiterRanges, "math")
  ) {
    return blockDecision;
  }

  const emptyMathCleanup = planEmptyMathBlockBackspaceCleanup(state, changes);
  if (emptyMathCleanup) {
    return {
      kind: "rewrite",
      changes: emptyMathCleanup,
    };
  }

  const openingFenceCleanup = planOpeningFenceDeletionCleanup(
    state,
    changes,
    policy.allFencedBlocks,
  );
  if (openingFenceCleanup) {
    return {
      kind: "rewrite",
      changes: openingFenceCleanup,
    };
  }

  return allowDecision;
}
