import { type EditorState, StateField, type Transaction } from "@codemirror/state";

import type { NumberingScheme } from "../parser/frontmatter";
import { docChangeTouchesFencedDivStructure } from "../fenced-block/model";
import {
  computeBlockNumberingKeyFromFencedDivs,
  computeBlockNumbers,
  mapBlockCounterState,
  type BlockCounterState,
} from "./block-counter-core";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "./document-analysis";
import { createChangeChecker } from "./change-detection";
import { frontmatterField } from "./frontmatter-state";
import { pluginRegistryField } from "./plugin-registry";

export type {
  BlockCounterState,
  NumberedBlock,
} from "./block-counter-core";

/** Read the effective numbering scheme from frontmatter state. */
function getEffectiveNumbering(state: EditorState): NumberingScheme {
  return state.field(frontmatterField).config.numbering ?? "grouped";
}

const fencedDivsRevisionChanged = createChangeChecker((state) =>
  getDocumentAnalysisSliceRevision(state.field(documentSemanticsField), "fencedDivs")
);

const blockCounterConfigChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField),
  getEffectiveNumbering,
);

function shouldRecomputeBlockNumbers(tr: Transaction): boolean {
  // Check fencedDivs first — revision can change from async tree updates
  // (Lezer parse completion), not just doc edits. Without this, block
  // numbers go stale when the parser discovers new fenced divs after the
  // initial partial parse (#752).
  if (fencedDivsRevisionChanged(tr)) {
    return true;
  }

  if (!tr.docChanged && !tr.reconfigured) {
    return false;
  }

  return blockCounterConfigChanged(tr);
}

function nextBlockNumberingKey(tr: Transaction): string {
  return computeBlockNumberingKeyFromFencedDivs(
    tr.state.field(documentSemanticsField).fencedDivs,
    tr.state.field(pluginRegistryField),
    getEffectiveNumbering(tr.state),
  );
}

function blockCounterStateFitsDoc(
  value: BlockCounterState,
  docLength: number,
): boolean {
  return value.blocks.every((block) =>
    block.from >= 0 &&
    block.from <= block.to &&
    block.to <= docLength
  );
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
    if (!shouldRecomputeBlockNumbers(tr)) {
      return value;
    }

    const configChanged = blockCounterConfigChanged(tr);
    const canMapExistingPositions = blockCounterStateFitsDoc(
      value,
      tr.startState.doc.length,
    );

    if (
      tr.docChanged
      && !configChanged
      && !docChangeTouchesFencedDivStructure(tr)
    ) {
      return canMapExistingPositions
        ? mapBlockCounterState(value, tr.changes)
        : computeBlockNumbers(
            tr.state,
            tr.state.field(pluginRegistryField),
            getEffectiveNumbering(tr.state),
          );
    }

    if (
      !configChanged
      && nextBlockNumberingKey(tr) === value.numberingKey
    ) {
      if (!tr.docChanged) {
        return value;
      }
      return canMapExistingPositions
        ? mapBlockCounterState(value, tr.changes)
        : computeBlockNumbers(
            tr.state,
            tr.state.field(pluginRegistryField),
            getEffectiveNumbering(tr.state),
          );
    }

    return computeBlockNumbers(
      tr.state,
      tr.state.field(pluginRegistryField),
      getEffectiveNumbering(tr.state),
    );
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
