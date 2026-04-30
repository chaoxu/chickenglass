/**
 * Transaction filters and atomic ranges that protect fenced block fence syntax
 * (fenced divs, fenced code blocks, and display math) from accidental edits
 * in rich mode.
 *
 * Extracted from plugin-render.ts so that fence protection is a standalone
 * module with clear boundaries. The blockRenderPlugin wires this extension
 * into the editor; block-type-picker uses the bypass annotation.
 *
 * Unified in #441 to cover both `::: {.class} ... :::` fenced divs and
 * ``` ``` ... ``` ``` fenced code blocks with a single protection stack.
 * Extended in #777 to cover `$$ ... $$` and `\[ ... \]` display math.
 *
 * Provides:
 * - `fenceOperationAnnotation` — bypass annotation for programmatic edits
 * - `getProtectedDivs` — collect fenced divs eligible for protection
 * - `getClosingFenceRanges` — closing fence line ranges (divs + code blocks + math)
 * - `getOpeningFenceColonRanges` — opening fence colon-prefix ranges (divs only)
 * - `getOpeningFenceBacktickRanges` — opening fence backtick-prefix ranges (code blocks only)
 * - `getOpeningMathDelimiterRanges` — opening math delimiter ranges (display math only)
 * - `fenceProtectionExtension` — unified CM6 extension with one transaction pipeline
 * - compatibility filter exports used by focused tests and narrow consumers
 * - `pairedMathEntry` — auto-insert closing delimiter when typing $$ or \[
 * - `closingFenceAtomicRanges` — cursor skips over hidden closing fences
 */

import {
  Annotation,
  EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { FencedDivInfo } from "../fenced-block/model";
import {
  type FenceChangeSpec,
  type FenceRange,
} from "./fence-protection-pipeline";
import {
  createClosingFenceProtection,
  createEmptyMathBlockBackspaceCleanup,
  createFenceProtectionTransactionFilter,
  createOpeningFenceBacktickProtection,
  createOpeningFenceColonProtection,
  createOpeningFenceDeletionCleanup,
  createOpeningFenceMathProtection,
} from "./fence-transaction-filters";
import { createPairedMathEntry } from "./fence-math-entry";
import {
  collectAllFencedBlocks,
  docChangeCouldAffectDisplayMathFences,
  fenceProtectionCacheField,
  getFenceProtectionCache,
} from "./fence-protection-cache";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";

// ---------------------------------------------------------------------------
// Fence protection
// ---------------------------------------------------------------------------

/** Annotation to bypass fence protection filters (used by block-type picker). */
export const fenceOperationAnnotation = Annotation.define<true>();

function shouldBypassFenceProtection(tr: Transaction): boolean {
  return !tr.docChanged
    || Boolean(tr.annotation(fenceOperationAnnotation))
    || Boolean(tr.annotation(programmaticDocumentChangeAnnotation));
}

function annotateFenceRewrite(
  changes: FenceChangeSpec | readonly FenceChangeSpec[],
) {
  return {
    changes,
    annotations: fenceOperationAnnotation.of(true),
  };
}

/**
 * Return fenced divs that should have their fences protected.
 * Filters out single-line divs, excluded classes (include), and
 * unregistered block types. Shared by all fence range collectors
 * to avoid repeated collectFencedDivs + filtering per transaction.
 */
export function getProtectedDivs(state: EditorState): readonly FencedDivInfo[] {
  return getFenceProtectionCache(state).protectedDivs;
}

/**
 * Collect closing fence line ranges for protection from fenced divs,
 * fenced code blocks, and display math. All multi-line code blocks and
 * display math blocks are protected unconditionally (they have no
 * registry/class filtering like divs).
 */
export function getClosingFenceRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).closingFenceRanges;
}

/** Collect opening fence colon-prefix ranges for protection (fenced divs only). */
export function getOpeningFenceColonRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingFenceColonRanges;
}

/** Collect opening fence backtick-prefix ranges for protection (code blocks only). */
export function getOpeningFenceBacktickRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingFenceBacktickRanges;
}

/**
 * Transaction filter that auto-removes the closing fence when an opening fence
 * line is fully deleted. Kept as a compatibility export for focused tests;
 * `fenceProtectionExtension` runs the unified pipeline instead of stacking
 * this filter with other independent protections.
 */
export const openingFenceDeletionCleanup = createOpeningFenceDeletionCleanup({
  shouldBypassFenceProtection,
  annotateFenceRewrite,
  getAllFencedBlocks: collectAllFencedBlocks,
});

/**
 * Transaction filter that protects closing fence lines from accidental deletion.
 *
 * Covers both fenced divs and fenced code blocks. Blocks any edit that touches
 * only the closing fence line content. Whole-block deletion (selection covering
 * the entire fenced block) is still allowed so that Cmd+A + Delete works.
 */
export const closingFenceProtection = createClosingFenceProtection({
  shouldBypassFenceProtection,
  getClosingFenceRanges,
});

/**
 * Transaction filter that protects opening fence colon prefixes from accidental edits.
 *
 * In rich mode, users interact with the widget label, not the raw colons.
 * Edits that touch only the colon prefix (:::) are blocked to prevent
 * nesting invariant violations. Edits to attributes ({.theorem}) and
 * title text are unaffected. Whole-block deletion is still allowed.
 *
 * Applies to fenced divs only — code blocks use backtick fences which
 * have no colon prefix.
 */
export const openingFenceColonProtection = createOpeningFenceColonProtection({
  shouldBypassFenceProtection,
  getOpeningFenceColonRanges,
});

/**
 * Transaction filter that protects opening code-fence backtick prefixes.
 *
 * Mirrors openingFenceColonProtection for fenced divs: edits that target only
 * the opening ``` prefix are blocked, while language/info-string edits and
 * whole-block deletion remain allowed.
 */
export const openingFenceBacktickProtection = createOpeningFenceBacktickProtection({
  shouldBypassFenceProtection,
  getOpeningFenceBacktickRanges,
});

/** Collect opening math delimiter ranges for protection (display math only). */
export function getOpeningMathDelimiterRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingMathDelimiterRanges;
}

/**
 * Transaction filter that protects opening display math delimiter prefixes.
 *
 * Mirrors openingFenceColonProtection for fenced divs: edits that target only
 * the opening $$ or \[ prefix are blocked, while whole-block deletion remains
 * allowed.
 */
export const openingFenceMathProtection = createOpeningFenceMathProtection({
  shouldBypassFenceProtection,
  getOpeningMathDelimiterRanges,
});

/**
 * Atomic ranges for closing fence lines so the cursor skips over them.
 *
 * Covers both fenced divs and fenced code blocks. Uses EditorView.atomicRanges
 * to make hidden closing fences behave as a single atomic unit — the cursor
 * jumps from the last content line to the start of the next block or paragraph
 * without stopping on the fence.
 */
export const closingFenceAtomicRanges = EditorView.atomicRanges.of((view) => {
  return getFenceProtectionCache(view.state).closingFenceAtomicRanges;
});

/**
 * Input handler for paired math entry. When the user completes a display math
 * opening delimiter on a blank line ($$ or \[), auto-insert the closing
 * delimiter and place the cursor between them.
 *
 * Skips auto-insert if the next non-blank line already contains the matching
 * closing delimiter (bracket-match skip).
 */
export const pairedMathEntry = createPairedMathEntry(fenceOperationAnnotation);

/**
 * Transaction filter that removes an empty display math block when a backspace
 * joins the blank content line with the opening delimiter.
 *
 * After pairedMathEntry creates `$$\n\n$$`, pressing Backspace on the empty
 * content line would normally just delete the newline, producing `$$\n$$` with
 * the closing delimiter orphaned. This filter detects that pattern — a single-
 * character newline deletion where the line above is a math opening delimiter
 * and all content below (until the closing delimiter) is blank — and expands
 * the deletion to remove the entire block.
 *
 * Works for both `$$` and `\[`/`\]` delimiter styles.
 */
export const emptyMathBlockBackspaceCleanup = createEmptyMathBlockBackspaceCleanup({
  shouldBypassFenceProtection,
  annotateFenceRewrite,
});

const fenceProtectionTransactionFilter = createFenceProtectionTransactionFilter({
  shouldBypassFenceProtection,
  annotateFenceRewrite,
  getFenceProtectionDecisionInputs(state) {
    const cache = getFenceProtectionCache(state);
    return {
      allFencedBlocks: cache.allFencedBlocks,
      closingFenceRanges: cache.closingFenceRanges,
      openingFenceColonRanges: cache.openingFenceColonRanges,
      openingFenceBacktickRanges: cache.openingFenceBacktickRanges,
      openingMathDelimiterRanges: cache.openingMathDelimiterRanges,
    };
  },
});

/**
 * Combined CM6 extension for all fence protection behavior.
 *
 * Covers fenced divs, fenced code blocks (#441), and display math (#777).
 * The transaction filter now runs one explicit decision pipeline:
 * block illegal edits first, then apply cleanup rewrites, so behavior no
 * longer depends on a stack of separately registered filters.
 */
export const fenceProtectionExtension: Extension = [
  fenceProtectionCacheField,
  fenceProtectionTransactionFilter,
  pairedMathEntry,
  closingFenceAtomicRanges,
];

export type { FenceRange } from "./fence-protection-pipeline";
export { fenceProtectionCacheField as _fenceProtectionCacheFieldForTest };
export { docChangeCouldAffectDisplayMathFences as _docChangeCouldAffectDisplayMathFencesForTest };
