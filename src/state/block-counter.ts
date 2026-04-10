import { type EditorState, StateField, type Transaction } from "@codemirror/state";

import type { NumberingScheme } from "../parser/frontmatter";
import {
  computeBlockNumbers,
  type BlockCounterState,
} from "../plugins/block-counter";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import { frontmatterField } from "./frontmatter-state";
import { pluginRegistryField } from "./plugin-registry";

export type {
  BlockCounterState,
  NumberedBlock,
} from "../plugins/block-counter";

/** Read the effective numbering scheme from frontmatter state. */
function getEffectiveNumbering(state: EditorState): NumberingScheme {
  return state.field(frontmatterField).config.numbering ?? "grouped";
}

function shouldRecomputeBlockNumbers(tr: Transaction): boolean {
  // Check fencedDivs first — revision can change from async tree updates
  // (Lezer parse completion), not just doc edits. Without this, block
  // numbers go stale when the parser discovers new fenced divs after the
  // initial partial parse (#752).
  const startSemantics = tr.startState.field(documentSemanticsField);
  const nextSemantics = tr.state.field(documentSemanticsField);
  if (
    getDocumentAnalysisSliceRevision(startSemantics, "fencedDivs")
    !== getDocumentAnalysisSliceRevision(nextSemantics, "fencedDivs")
  ) {
    return true;
  }

  if (!tr.docChanged && !tr.reconfigured) {
    return false;
  }

  if (tr.startState.field(pluginRegistryField) !== tr.state.field(pluginRegistryField)) {
    return true;
  }

  return getEffectiveNumbering(tr.startState) !== getEffectiveNumbering(tr.state);
}

/**
 * CM6 StateField that maintains block numbering.
 *
 * Depends on the pluginRegistryField to know which plugins are
 * registered and which counter groups they use.
 *
 * Usage:
 * ```ts
 * const counters = state.field(blockCounterField);
 * const entry = counters.byId.get("thm-1");
 * ```
 */
export const blockCounterField = StateField.define<BlockCounterState>({
  create(state) {
    return computeBlockNumbers(
      state,
      state.field(pluginRegistryField),
      getEffectiveNumbering(state),
    );
  },

  update(value, tr) {
    if (shouldRecomputeBlockNumbers(tr)) {
      return computeBlockNumbers(
        tr.state,
        tr.state.field(pluginRegistryField),
        getEffectiveNumbering(tr.state),
      );
    }
    return value;
  },

  compare(a, b) {
    if (a.blocks.length !== b.blocks.length) return false;
    for (let i = 0; i < a.blocks.length; i++) {
      const ba = a.blocks[i];
      const bb = b.blocks[i];
      if (
        ba.from !== bb.from || ba.to !== bb.to ||
        ba.type !== bb.type || ba.id !== bb.id ||
        ba.number !== bb.number
      ) return false;
    }
    return true;
  },
});
