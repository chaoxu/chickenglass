/**
 * Transaction filters and atomic ranges that protect fenced div fence syntax
 * from accidental edits in rich mode.
 *
 * Extracted from plugin-render.ts so that fence protection is a standalone
 * module with clear boundaries. The blockRenderPlugin wires this extension
 * into the editor; block-type-picker uses the bypass annotation.
 *
 * Provides:
 * - `fenceOperationAnnotation` — bypass annotation for programmatic edits
 * - `getProtectedDivs` — collect fenced divs eligible for protection
 * - `getClosingFenceRanges` — closing fence line ranges
 * - `getOpeningFenceColonRanges` — opening fence colon-prefix ranges
 * - `openingFenceDeletionCleanup` — auto-remove closing fence on opening delete
 * - `closingFenceProtection` — block edits targeting only the closing fence
 * - `openingFenceColonProtection` — block edits targeting opening fence colons
 * - `closingFenceAtomicRanges` — cursor skips over hidden closing fences
 * - `fenceProtectionExtension` — combined CM6 extension
 */

import {
  type Range,
  Annotation,
  EditorState,
  type Extension,
  RangeSet,
} from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { pluginRegistryField, getPluginOrFallback } from "./plugin-registry";
import type { FencedBlockInfo } from "../render/fenced-block-core";
import {
  type FencedDivSemantics,
} from "../semantics/document";
import { documentSemanticsField } from "../semantics/codemirror-source";
import { countColons } from "../parser";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";

// ---------------------------------------------------------------------------
// Shared types and helpers
// ---------------------------------------------------------------------------

/** Full info about a fenced div, combining block geometry and semantics. */
export interface FencedDivInfo extends FencedBlockInfo, FencedDivSemantics {
  readonly className: string;
}

/** Extract info about FencedDiv nodes from the shared semantics field. */
export function collectFencedDivs(state: EditorState): FencedDivInfo[] {
  return state.field(documentSemanticsField).fencedDivs
    .filter((div): div is FencedDivSemantics & { primaryClass: string } => Boolean(div.primaryClass))
    .map((div) => ({
      ...div,
      className: div.primaryClass,
    }));
}

// ---------------------------------------------------------------------------
// Fence protection
// ---------------------------------------------------------------------------

/** Annotation to bypass fence protection filters (used by block-type picker). */
export const fenceOperationAnnotation = Annotation.define<true>();

/**
 * Return fenced divs that should have their fences protected.
 * Filters out single-line divs, excluded classes (include), and
 * unregistered block types. Shared by all fence range collectors
 * to avoid repeated collectFencedDivs + filtering per transaction.
 */
export function getProtectedDivs(state: EditorState): FencedDivInfo[] {
  const divs = collectFencedDivs(state);
  const registry = state.field(pluginRegistryField, false);
  return divs.filter((div) => {
    if (div.singleLine) return false;
    if (EXCLUDED_FROM_FALLBACK.has(div.className)) return false;
    if (registry && !getPluginOrFallback(registry, div.className)) return false;
    return true;
  });
}

/** Collect closing fence line ranges for protection. */
export function getClosingFenceRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const div of getProtectedDivs(state)) {
    if (div.closeFenceFrom < 0) continue;
    const line = state.doc.lineAt(div.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }
  return ranges;
}

/** Collect opening fence colon-prefix ranges for protection. */
export function getOpeningFenceColonRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const div of getProtectedDivs(state)) {
    if (seen.has(div.openFenceFrom)) continue;
    seen.add(div.openFenceFrom);
    const text = state.sliceDoc(div.openFenceFrom, div.openFenceTo);
    const colonLen = countColons(text, 0);
    if (colonLen >= 3) {
      ranges.push({ from: div.openFenceFrom, to: div.openFenceFrom + colonLen });
    }
  }
  return ranges;
}

/**
 * Transaction filter that auto-removes the closing fence when an opening fence
 * line is fully deleted. Without this, deleting a block's header leaves an
 * orphaned closing `:::` in the document.
 *
 * Uses collectFencedDivs directly (not getProtectedDivs) because cleanup
 * should apply to ALL fenced divs, including unregistered/custom types.
 * Protection filters are narrower — they only guard registered blocks.
 *
 * The returned spec carries fenceOperationAnnotation so both protection
 * filters are bypassed for the combined structural deletion.
 */
export const openingFenceDeletionCleanup = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;

  const state = tr.startState;
  const divs = collectFencedDivs(state);
  if (divs.length === 0) return tr;

  const closingFencesToRemove: { from: number; to: number }[] = [];

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length > 1) return;

    for (const div of divs) {
      if (div.singleLine || div.closeFenceFrom < 0) continue;

      const openLine = state.doc.lineAt(div.openFenceFrom);

      if (fromA <= openLine.from && toA >= openLine.to) {
        if (fromA <= div.closeFenceFrom && toA >= div.closeFenceTo) continue;

        // Include the preceding newline so the line is fully removed
        const closeLine = state.doc.lineAt(div.closeFenceFrom);
        const removeFrom = closeLine.from > 0 ? closeLine.from - 1 : closeLine.from;
        const removeTo = closeLine.to < state.doc.length ? closeLine.to + 1 : closeLine.to;
        closingFencesToRemove.push({ from: removeFrom, to: removeTo });
      }
    }
  });

  if (closingFencesToRemove.length === 0) return tr;

  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  for (const c of closingFencesToRemove) {
    changes.push({ from: c.from, to: c.to, insert: "" });
  }
  // CM6 requires changes sorted by position and non-overlapping
  changes.sort((a, b) => a.from - b.from);

  return {
    changes,
    annotations: fenceOperationAnnotation.of(true),
  };
});

/**
 * Transaction filter that protects closing fence lines from accidental deletion.
 *
 * Blocks any edit that touches only the closing fence line content. Whole-block
 * deletion (selection covering the entire fenced div) is still allowed so that
 * Cmd+A + Delete works.
 */
export const closingFenceProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // Bypass for programmatic fence operations (block-type picker, etc.)
  if (tr.annotation(fenceOperationAnnotation)) return tr;

  const fenceRanges = getClosingFenceRanges(tr.startState);
  if (fenceRanges.length === 0) return tr;

  const docLen = tr.startState.doc.length;
  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const fence of fenceRanges) {
      if (fromA <= fence.to && toA >= fence.from) {
        // Account for document boundaries: start-of-doc counts as "before",
        // end-of-doc counts as "after".
        const extendsBeforeFence = fromA < fence.from - 1 || fromA === 0;
        const extendsAfterFence = toA > fence.to + 1 || toA >= docLen;
        if (extendsBeforeFence && extendsAfterFence) continue;
        // Allow if it's a replacement that includes the fence (structural edit)
        if (inserted.length > 0 && extendsBeforeFence) continue;
        // Block: the edit targets only the closing fence
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
});

/**
 * Transaction filter that protects opening fence colon prefixes from accidental edits.
 *
 * In rich mode, users interact with the widget label, not the raw colons.
 * Edits that touch only the colon prefix (:::) are blocked to prevent
 * nesting invariant violations. Edits to attributes ({.theorem}) and
 * title text are unaffected. Whole-block deletion is still allowed.
 */
export const openingFenceColonProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;

  const colonRanges = getOpeningFenceColonRanges(tr.startState);
  if (colonRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const colon of colonRanges) {
      if (fromA <= colon.to && toA >= colon.from) {
        if (fromA === toA) continue; // pure insertion
        if (fromA >= colon.to) continue; // editing attrs/title after colons
        // Whole-block deletion: spans past colons on both sides
        const atOrBeforeStart = fromA <= colon.from;
        const pastColonEnd = toA > colon.to;
        if (atOrBeforeStart && pastColonEnd) continue;
        if (inserted.length > 0 && fromA < colon.from) continue; // structural replacement
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
});

/**
 * Atomic ranges for closing fence lines so the cursor skips over them.
 *
 * Uses EditorView.atomicRanges to make the hidden closing fence behave as
 * a single atomic unit — the cursor jumps from the last content line to
 * the start of the next block or paragraph without stopping on the fence.
 */
export const closingFenceAtomicRanges = EditorView.atomicRanges.of((view) => {
  const ranges: Range<Decoration>[] = [];
  const fenceRanges = getClosingFenceRanges(view.state);
  const mark = Decoration.mark({});
  for (const fence of fenceRanges) {
    // Include the newline before the fence to make cursor skip the whole line
    const atomicFrom = fence.from > 0 ? fence.from - 1 : fence.from;
    const atomicTo = fence.to < view.state.doc.length ? fence.to + 1 : fence.to;
    ranges.push(mark.range(atomicFrom, atomicTo));
  }
  return RangeSet.of(ranges, true);
});

/**
 * Combined CM6 extension for all fence protection behavior.
 *
 * CM6 runs transactionFilters in reverse registration order, so cleanup
 * (registered first) executes AFTER protections have already passed/blocked.
 */
export const fenceProtectionExtension: Extension = [
  openingFenceDeletionCleanup,
  closingFenceProtection,
  openingFenceColonProtection,
  closingFenceAtomicRanges,
];
