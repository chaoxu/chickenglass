/**
 * Browser-native spellcheck integration for the CM6 editor.
 *
 * Enables browser spellcheck on the editor contenteditable, then uses
 * CM6 attribute decorations to disable it inside math, code, and citation
 * ranges — where spell checking would produce false positives.
 *
 * Toggle via Mod-Shift-s or the command palette.
 */

import {
  Compartment,
  type Extension,
  StateEffect,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { collectNodes } from "../render/node-collection";
import { buildDecorations } from "../render/decoration-core";
import { createBooleanToggleField } from "../render/focus-state";
import { MATH_TYPES } from "../render/math-source";
import { documentAnalysisField } from "../state/document-analysis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lezer node type names for code blocks (inline and fenced). */
const CODE_TYPES = new Set(["InlineCode", "FencedCode"]);

/** Combined set of node types whose content should not be spell-checked. */
const NO_SPELLCHECK_TYPES = new Set([...MATH_TYPES, ...CODE_TYPES]);

/** Decoration.mark that disables spellcheck on the decorated range. */
const noSpellcheck = Decoration.mark({
  attributes: { spellcheck: "false" },
});

// ---------------------------------------------------------------------------
// Build decorations from the syntax tree + crossref resolver
// ---------------------------------------------------------------------------

/**
 * Build a DecorationSet marking math, code, and citation ranges with
 * spellcheck="false". Reuses shared syntax discovery plus document analysis
 * so reference ranges are not re-scanned locally.
 */
function buildSpellcheckDecorations(view: EditorView): DecorationSet {
  const syntaxNodes = collectNodes(view, NO_SPELLCHECK_TYPES);
  const crossrefRanges = view.state.field(documentAnalysisField).references
    .filter((ref) => ref.ids.length === 1)
    .map((ref) => ({ from: ref.from, to: ref.to }));

  const items = [
    ...syntaxNodes.map((n) => noSpellcheck.range(n.from, n.to)),
    ...crossrefRanges.map((r) => noSpellcheck.range(r.from, r.to)),
  ];

  return buildDecorations(items);
}

// ---------------------------------------------------------------------------
// ViewPlugin that maintains the spellcheck-false decorations
// ---------------------------------------------------------------------------

class SpellcheckPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildSpellcheckDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.decorations = buildSpellcheckDecorations(update.view);
    }
  }
}

const spellcheckMarkViewPlugin = ViewPlugin.fromClass(SpellcheckPlugin, {
  decorations: (v) => v.decorations,
});
const spellcheckMarkPlugin: Extension = spellcheckMarkViewPlugin;

export { spellcheckMarkViewPlugin as _spellcheckMarkViewPluginForTest };

// ---------------------------------------------------------------------------
// Global spellcheck enable/disable (contentAttributes)
// ---------------------------------------------------------------------------

/** Content attribute that enables browser spellcheck on the editor. */
const spellcheckOn = EditorView.contentAttributes.of({ spellcheck: "true" });

/** Content attribute that disables browser spellcheck on the editor. */
const spellcheckOff = EditorView.contentAttributes.of({ spellcheck: "false" });

// ---------------------------------------------------------------------------
// Toggle machinery
// ---------------------------------------------------------------------------

/** Effect to set spellcheck enabled state. */
export const setSpellcheckEffect = StateEffect.define<boolean>();

/**
 * StateField that tracks whether spellcheck is enabled (true by default).
 * Updated atomically with the compartment reconfiguration in toggleSpellcheck.
 */
export const spellcheckEnabledField = createBooleanToggleField(setSpellcheckEffect, true);

/** Compartment wrapping the active spellcheck extensions. */
const spellcheckCompartment = new Compartment();

/** Build the inner extensions for the given enabled state. */
function innerExtensions(enabled: boolean): Extension {
  return enabled ? [spellcheckOn, spellcheckMarkPlugin] : spellcheckOff;
}

/**
 * Toggle spellcheck on the given editor view.
 * Updates both the StateField and the Compartment in a single dispatch
 * so they remain consistent.
 * Returns true (consumed keymap event).
 */
export function toggleSpellcheck(view: EditorView): boolean {
  const next = !view.state.field(spellcheckEnabledField);
  view.dispatch({
    effects: [
      setSpellcheckEffect.of(next),
      spellcheckCompartment.reconfigure(innerExtensions(next)),
    ],
  });
  return true;
}

/**
 * CM6 extension bundle for browser-native spellcheck.
 *
 * - Enables `spellcheck="true"` on the contenteditable.
 * - Marks math, code, and citation ranges with `spellcheck="false"`.
 * - Provides `toggleSpellcheck` command and `spellcheckEnabledField`.
 */
export const spellcheckExtension: Extension = [
  spellcheckEnabledField,
  spellcheckCompartment.of(innerExtensions(true)),
];
