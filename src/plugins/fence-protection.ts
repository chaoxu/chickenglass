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
 * - `openingFenceDeletionCleanup` — auto-remove closing fence on opening delete
 * - `closingFenceProtection` — block edits targeting only the closing fence
 * - `openingFenceColonProtection` — block edits targeting opening fence colons
 * - `openingFenceBacktickProtection` — block edits targeting opening fence backticks
 * - `openingFenceMathProtection` — block edits targeting opening math delimiters
 * - `pairedMathEntry` — auto-insert closing delimiter when typing $$ or \[
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
import { collectCodeBlocks } from "../render/code-block-render";
import { countColons } from "../parser";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { programmaticDocumentChangeAnnotation } from "../editor/programmatic-document-change";

// ---------------------------------------------------------------------------
// Shared types and helpers
// ---------------------------------------------------------------------------

/** Full info about a fenced div, combining block geometry and semantics. */
export interface FencedDivInfo extends FencedBlockInfo, FencedDivSemantics {
  readonly className: string;
}

/**
 * Extract info about FencedDiv nodes from the shared semantics field.
 * Returns an empty array if the semantics field is not present in the state
 * (e.g. in minimal test configurations).
 */
export function collectFencedDivs(state: EditorState): FencedDivInfo[] {
  const semantics = state.field(documentSemanticsField, false);
  if (!semantics) return [];
  return semantics.fencedDivs
    .filter((div): div is FencedDivSemantics & { primaryClass: string } => Boolean(div.primaryClass))
    .map((div) => ({
      ...div,
      className: div.primaryClass,
    }));
}

/**
 * Collect multi-line display math blocks as FencedBlockInfo for protection.
 * Reads from documentSemanticsField.mathRegions, filtering for isDisplay.
 * The opening fence is the $$ or \[ line; the closing fence is the $$ or \] line.
 */
function collectDisplayMathBlocks(state: EditorState): FencedBlockInfo[] {
  const semantics = state.field(documentSemanticsField, false);
  if (!semantics) return [];

  const results: FencedBlockInfo[] = [];
  for (const region of semantics.mathRegions) {
    if (!region.isDisplay) continue;

    const openLine = state.doc.lineAt(region.from);
    // contentTo sits at the start of the closing delimiter mark ($$  or \])
    const closeLine = state.doc.lineAt(region.contentTo);
    if (closeLine.from === openLine.from) continue; // single-line display math

    results.push({
      from: region.from,
      to: region.to,
      openFenceFrom: openLine.from,
      openFenceTo: openLine.to,
      closeFenceFrom: closeLine.from,
      closeFenceTo: closeLine.to,
      singleLine: false,
    });
  }
  return results;
}

/**
 * Collect all fenced blocks (fenced divs, code blocks, and display math) for
 * opening-fence deletion cleanup. Uses collectFencedDivs + collectCodeBlocks
 * + collectDisplayMathBlocks directly (not getProtectedDivs) because cleanup
 * should apply to ALL fenced blocks, including unregistered/custom types.
 */
function collectAllFencedBlocks(state: EditorState): FencedBlockInfo[] {
  const divs: FencedBlockInfo[] = collectFencedDivs(state);
  const codeBlocks: FencedBlockInfo[] = collectCodeBlocks(state);
  const mathBlocks: FencedBlockInfo[] = collectDisplayMathBlocks(state);
  return [...divs, ...codeBlocks, ...mathBlocks];
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

/**
 * Collect closing fence line ranges for protection from fenced divs,
 * fenced code blocks, and display math. All multi-line code blocks and
 * display math blocks are protected unconditionally (they have no
 * registry/class filtering like divs).
 */
export function getClosingFenceRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const seen = new Set<number>();

  // Fenced div closing fences (filtered by registry/class)
  for (const div of getProtectedDivs(state)) {
    if (div.closeFenceFrom < 0) continue;
    const line = state.doc.lineAt(div.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }

  // Code block closing fences (all multi-line code blocks)
  for (const block of collectCodeBlocks(state)) {
    if (block.singleLine || block.closeFenceFrom < 0) continue;
    const line = state.doc.lineAt(block.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }

  // Display math closing fences (all multi-line display math)
  for (const block of collectDisplayMathBlocks(state)) {
    const line = state.doc.lineAt(block.closeFenceFrom);
    if (!seen.has(line.from)) {
      seen.add(line.from);
      ranges.push({ from: line.from, to: line.to });
    }
  }

  return ranges;
}

/** Collect opening fence colon-prefix ranges for protection (fenced divs only). */
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

/** Collect opening fence backtick-prefix ranges for protection (code blocks only). */
export function getOpeningFenceBacktickRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const block of collectCodeBlocks(state)) {
    if (block.singleLine) continue;
    if (seen.has(block.openFenceFrom)) continue;
    seen.add(block.openFenceFrom);
    const text = state.sliceDoc(block.openFenceFrom, block.openFenceTo);
    const match = /^`{3,}/.exec(text);
    if (match) {
      ranges.push({
        from: block.openFenceFrom,
        to: block.openFenceFrom + match[0].length,
      });
    }
  }
  return ranges;
}

/**
 * Transaction filter that auto-removes the closing fence when an opening fence
 * line is fully deleted. Without this, deleting a block's header leaves an
 * orphaned closing fence (`::: ` or ``` ``` ```) in the document.
 *
 * Uses collectAllFencedBlocks (not getProtectedDivs) because cleanup
 * should apply to ALL fenced blocks, including unregistered/custom types.
 *
 * The returned spec carries fenceOperationAnnotation so both protection
 * filters are bypassed for the combined structural deletion.
 */
export const openingFenceDeletionCleanup = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const state = tr.startState;
  const blocks = collectAllFencedBlocks(state);
  if (blocks.length === 0) return tr;

  const closingFencesToRemove: { from: number; to: number }[] = [];

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length > 1) return;

    for (const block of blocks) {
      if (block.singleLine || block.closeFenceFrom < 0) continue;

      const openLine = state.doc.lineAt(block.openFenceFrom);

      // Full opening line deletion
      const fullLineDeletion = fromA <= openLine.from && toA >= openLine.to;

      // Partial deletion that removes the structural prefix (colons/backticks).
      // If the prefix is gone the line no longer parses as a fence, so the
      // closing delimiter must be cleaned up (#766).
      // Key off the actual prefix position, not the line start — fenced
      // blocks can be indented inside list items so openFenceFrom may be
      // past openLine.from, and code blocks set openFenceFrom to the line
      // start so the text may contain leading whitespace.
      let prefixBroken = false;
      if (!fullLineDeletion) {
        const rawText = state.sliceDoc(block.openFenceFrom, block.openFenceTo);
        // Skip leading whitespace — code blocks include indentation in
        // openFenceFrom..openFenceTo; fenced divs report openFenceFrom at
        // the first colon so indent is 0 for them.
        const indent = rawText.length - rawText.trimStart().length;
        const prefixStart = block.openFenceFrom + indent;
        const text = indent > 0 ? rawText.substring(indent) : rawText;
        const firstChar = text.charAt(0);
        let prefixEnd = -1;
        if (firstChar === ":") {
          const colonLen = countColons(text, 0);
          if (colonLen >= 3) prefixEnd = prefixStart + colonLen;
        } else if (firstChar === "`") {
          const match = /^`{3,}/.exec(text);
          if (match) prefixEnd = prefixStart + match[0].length;
        } else if (firstChar === "$" && text.startsWith("$$")) {
          prefixEnd = prefixStart + 2;
        } else if (firstChar === "\\" && text.startsWith("\\[")) {
          prefixEnd = prefixStart + 2;
        }
        if (prefixEnd > 0 && fromA <= prefixStart && toA >= prefixEnd) {
          prefixBroken = true;
        }
      }

      if (fullLineDeletion || prefixBroken) {
        if (fromA <= block.closeFenceFrom && toA >= block.closeFenceTo) continue;

        // Include the preceding newline so the line is fully removed
        const closeLine = state.doc.lineAt(block.closeFenceFrom);
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
  // CM6 requires changes sorted by position and non-overlapping.
  // Nested block deletion can produce overlapping closing-fence ranges
  // (e.g. a parent and child both schedule removal of adjacent/overlapping
  // fence lines). Merge them so CM6 doesn't crash on overlapping changes.
  changes.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: typeof changes = [];
  for (const c of changes) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && prev.insert === "" && c.insert === "" && c.from <= prev.to) {
      // Overlapping or adjacent deletion ranges — merge into one
      prev.to = Math.max(prev.to, c.to);
    } else {
      merged.push({ ...c });
    }
  }

  return {
    changes: merged,
    annotations: fenceOperationAnnotation.of(true),
  };
});

/**
 * Transaction filter that protects closing fence lines from accidental deletion.
 *
 * Covers both fenced divs and fenced code blocks. Blocks any edit that touches
 * only the closing fence line content. Whole-block deletion (selection covering
 * the entire fenced block) is still allowed so that Cmd+A + Delete works.
 */
export const closingFenceProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // Bypass for programmatic fence operations (block-type picker, etc.)
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

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
        const extendsAfterFence = toA >= fence.to + 1 || toA >= docLen;
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
 *
 * Applies to fenced divs only — code blocks use backtick fences which
 * have no colon prefix.
 */
export const openingFenceColonProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

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
 * Transaction filter that protects opening code-fence backtick prefixes.
 *
 * Mirrors openingFenceColonProtection for fenced divs: edits that target only
 * the opening ``` prefix are blocked, while language/info-string edits and
 * whole-block deletion remain allowed.
 */
export const openingFenceBacktickProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const backtickRanges = getOpeningFenceBacktickRanges(tr.startState);
  if (backtickRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const backticks of backtickRanges) {
      if (fromA <= backticks.to && toA >= backticks.from) {
        if (fromA === toA) continue; // pure insertion
        if (fromA >= backticks.to) continue; // editing language/info string after backticks
        const atOrBeforeStart = fromA <= backticks.from;
        const pastBacktickEnd = toA > backticks.to;
        if (atOrBeforeStart && pastBacktickEnd) continue;
        if (inserted.length > 0 && fromA < backticks.from) continue; // structural replacement
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
});

/** Collect opening math delimiter ranges for protection (display math only). */
export function getOpeningMathDelimiterRanges(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const block of collectDisplayMathBlocks(state)) {
    if (seen.has(block.openFenceFrom)) continue;
    seen.add(block.openFenceFrom);
    const text = state.sliceDoc(block.openFenceFrom, block.openFenceTo);
    const trimmed = text.trimStart();
    const indent = text.length - trimmed.length;
    let delimLen = 0;
    if (trimmed.startsWith("$$")) delimLen = 2;
    else if (trimmed.startsWith("\\[")) delimLen = 2;
    if (delimLen > 0) {
      ranges.push({
        from: block.openFenceFrom + indent,
        to: block.openFenceFrom + indent + delimLen,
      });
    }
  }
  return ranges;
}

/**
 * Transaction filter that protects opening display math delimiter prefixes.
 *
 * Mirrors openingFenceColonProtection for fenced divs: edits that target only
 * the opening $$ or \[ prefix are blocked, while whole-block deletion remains
 * allowed.
 */
export const openingFenceMathProtection = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const delimRanges = getOpeningMathDelimiterRanges(tr.startState);
  if (delimRanges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (blocked) return;
    for (const delim of delimRanges) {
      if (fromA <= delim.to && toA >= delim.from) {
        if (fromA === toA) continue; // pure insertion
        if (fromA >= delim.to) continue; // editing after delimiter
        const atOrBeforeStart = fromA <= delim.from;
        // Unlike colon/backtick protection (which uses strict >), math
        // delimiters use >= because the delimiter IS the entire opening
        // line content — there are no attrs/title after it. Covering the
        // full delimiter is an intentional deletion that the cleanup
        // filter should handle.
        const coversFullDelim = toA >= delim.to;
        if (atOrBeforeStart && coversFullDelim) continue;
        if (inserted.length > 0 && fromA < delim.from) continue; // structural replacement
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
 * Covers both fenced divs and fenced code blocks. Uses EditorView.atomicRanges
 * to make hidden closing fences behave as a single atomic unit — the cursor
 * jumps from the last content line to the start of the next block or paragraph
 * without stopping on the fence.
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
 * Input handler for paired math entry. When the user completes a display math
 * opening delimiter on a blank line ($$ or \[), auto-insert the closing
 * delimiter and place the cursor between them.
 *
 * Skips auto-insert if the next non-blank line already contains the matching
 * closing delimiter (bracket-match skip).
 */
export const pairedMathEntry = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to) return false; // has selection

  const state = view.state;
  const line = state.doc.lineAt(from);

  if (text === "$") {
    // Check if completing $$ on a blank line
    const before = state.sliceDoc(line.from, from);
    if (before !== "$") return false;
    const after = state.sliceDoc(from, line.to).trim();
    if (after !== "") return false;

    // Bracket-match skip: don't auto-insert if next non-blank line is $$
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const trimmed = state.doc.line(n).text.trim();
      if (trimmed === "") continue;
      if (trimmed === "$$") return false;
      break;
    }

    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "$$\n\n$$" },
      selection: { anchor: line.from + 3 },
      annotations: fenceOperationAnnotation.of(true),
    });
    return true;
  }

  if (text === "[") {
    // Check if completing \[ on a blank line
    const before = state.sliceDoc(line.from, from);
    if (before !== "\\") return false;
    const after = state.sliceDoc(from, line.to).trim();
    if (after !== "") return false;

    // Bracket-match skip: don't auto-insert if next non-blank line is \]
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const trimmed = state.doc.line(n).text.trim();
      if (trimmed === "") continue;
      if (trimmed === "\\]") return false;
      break;
    }

    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "\\[\n\n\\]" },
      selection: { anchor: line.from + 3 },
      annotations: fenceOperationAnnotation.of(true),
    });
    return true;
  }

  return false;
});

/**
 * Combined CM6 extension for all fence protection behavior.
 *
 * Covers fenced divs, fenced code blocks (#441), and display math (#777).
 *
 * CM6 runs transactionFilters in reverse registration order, so cleanup
 * (registered first) executes AFTER protections have already passed/blocked.
 */
export const fenceProtectionExtension: Extension = [
  openingFenceDeletionCleanup,
  closingFenceProtection,
  openingFenceColonProtection,
  openingFenceBacktickProtection,
  openingFenceMathProtection,
  pairedMathEntry,
  closingFenceAtomicRanges,
];
