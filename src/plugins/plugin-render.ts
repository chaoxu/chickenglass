/**
 * CM6 decoration provider for rendering fenced divs using the block plugin system.
 *
 * For each FencedDiv node in the syntax tree:
 * - If a plugin is registered for its class, render using CSS marks and line
 *   decorations (Typora-style: hide syntax, show block label via ::before).
 * - If no plugin is registered, render as a plain styled div.
 *
 * Uses Decoration.mark to hide fence syntax and Decoration.line with
 * data-block-label for the rendered header. The DOM structure never changes
 * between source and rendered mode — only CSS classes are toggled.
 *
 * Uses a StateField (not ViewPlugin) so that line decorations (Decoration.line)
 * are permitted by CM6.
 */

import type { Transaction } from "@codemirror/state";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { CSS } from "../constants/css-classes";
import { activeFencedOpenFenceStarts } from "../editor/shell-ownership";
import {
  hasStructureEditEffect,
  isFencedStructureEditActive,
} from "../editor/structure-edit-state";
import {
  collectFencedDivs,
  type FencedDivInfo,
} from "../fenced-block/model";
import { pluginRenderAdapter } from "../lib/plugin-render-adapter";
import {
  addSingleLineClosingFence,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  decorationHidden,
  editorFocusField,
  focusTracker,
  hideMultiLineClosingFence,
  mathMacrosField,
} from "../render/render-core";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../semantics/codemirror-source";
import { type BlockCounterState, blockCounterField } from "../state/block-counter";
import { pluginRegistryField } from "../state/plugin-registry";
import { fenceProtectionExtension } from "./fence-protection";
import { getPluginOrFallback } from "./plugin-registry";
import {
  addAttributeTitleDecoration,
  addCaptionDecoration,
  addHeaderWidgetDecoration,
  addInlineHeaderDecoration,
  addInlineTitleParenDecorations,
} from "./plugin-render-chrome";
import { addEmbedWidget } from "./plugin-render-embed";
import type { BlockAttrs } from "./plugin-types";

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}


/** Hide all fence syntax for include blocks so content flows seamlessly. */
function addIncludeDecorations(
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  // Hide the entire opening fence line
  items.push(decorationHidden.range(div.openFenceFrom, div.openFenceTo));
  if (div.attrFrom !== undefined && div.attrTo !== undefined) {
    items.push(decorationHidden.range(div.attrFrom, div.attrTo));
  }
  if (div.titleFrom !== undefined && div.titleTo !== undefined) {
    items.push(decorationHidden.range(div.titleFrom, div.titleTo));
  }
  // Hide closing fence
  if (div.closeFenceFrom >= 0 && div.closeFenceTo > div.closeFenceFrom) {
    items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
  }
  // Collapse fence lines to zero height
  items.push(
    Decoration.line({ class: CSS.includeFence }).range(div.openFenceFrom),
  );
  if (div.closeFenceFrom >= 0) {
    items.push(
      Decoration.line({ class: CSS.includeFence }).range(div.closeFenceFrom),
    );
  }
}

/** Add right-aligned QED tombstone on the last content line of proof blocks. */
function addQedDecoration(
  state: EditorState,
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  if (div.closeFenceFrom < 0) return;

  const closeLine = state.doc.lineAt(div.closeFenceFrom);
  if (closeLine.number > 1) {
    const lastContentLine = state.doc.line(closeLine.number - 1);
    if (lastContentLine.from > div.openFenceFrom) {
      items.push(
        Decoration.line({ class: CSS.blockQed }).range(lastContentLine.from),
      );
    }
  }
}

/**
 * Build decorations for all fenced divs using the plugin registry.
 *
 * Each fence (opening and closing) is independently toggled between
 * rendered and source mode based on cursor position. Touching one
 * block's fence never affects any other block's decorations.
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const macros = state.field(mathMacrosField);
  const activeShellStarts = activeFencedOpenFenceStarts(state);

  const baseDecos = buildFencedBlockDecorations(state, collectFencedDivs, ({
    state,
    block: div,
    openLine,
    closeLine,
  }, items) => {
    const plugin = getPluginOrFallback(registry, div.className);

    // Include blocks are always invisible — content flows seamlessly
    if (EXCLUDED_FROM_FALLBACK.has(div.className)) {
      addIncludeDecorations(div, items);
      return;
    }

    if (!plugin) return;

    const isEmbed = plugin.specialBehavior === "embed";
    const structureEditActive = isFencedStructureEditActive(state, div);
    const activeShell = activeShellStarts.has(div.openFenceFrom);

    const numberEntry = counterState?.byPosition.get(div.from);
    const labelAttrs: BlockAttrs = {
      type: div.className,
      id: div.id,
      title: div.title,
      number: numberEntry?.number,
    };
    const spec = plugin.render(labelAttrs);
    const captionBelow = plugin.captionPosition === "below";
    const inlineHeader = plugin.headerPosition === "inline";
    const openerSourceActive = structureEditActive && (
      captionBelow ||
      inlineHeader ||
      div.titleFrom === undefined ||
      div.titleTo === undefined
    );
    const hasVisibleBody = closeLine.number > openLine.number + 1;
    const openerLineVisible =
      openerSourceActive || (!captionBelow && !inlineHeader && plugin.displayHeader !== false);
    const bottomOnCaption = activeShell && captionBelow && !openerSourceActive && hasVisibleBody;
    const openerIsBottom = activeShell && !hasVisibleBody && !bottomOnCaption;

    // --- Opening fence ---
    // Heading-like pattern: ALWAYS apply block styling, toggle marker visibility.
    // The widget replaces only the fence prefix (::: {.class}), NOT the title text.
    // Title text stays as editable content — inline plugins render math/bold/etc.
    // See CLAUDE.md "Block headers must behave like headings."
    //
    // When in source mode, cf-block-source is a MARK decoration on the fence
    // syntax only ("::: {.class}"), NOT a line decoration. This keeps the title
    // text in its natural serif font — only syntax scaffolding gets monospace.
    //
    // displayHeader === false (e.g. blockquote): omit cf-block-header so the
    // opening fence line has no rendered label. The widget still hides fence
    // syntax; block styling is still applied via spec.className.
    //
    // captionPosition === "below" (figure, table): the header label goes on
    // the last body line instead of the opening fence. The opening fence gets
    // collapsed (no label) and the title text becomes the caption, displayed
    // on the opening line without the "Figure 1." prefix.
    const showHeader = openerSourceActive || (
      plugin.displayHeader !== false &&
      !captionBelow &&
      !inlineHeader
    );
    const headerClass = joinClasses(
      spec.className,
      showHeader ? CSS.blockHeader : CSS.blockHeaderCollapsed,
      activeShell && CSS.activeShell,
      activeShell && openerLineVisible && CSS.activeShellTop,
      openerIsBottom && openerLineVisible && CSS.activeShellBottom,
    );
    items.push(Decoration.line({ class: headerClass }).range(div.from));
    // Always keep the widget replacement active — structure editing uses
    // explicit mapped state, not raw-text editing of the fence syntax.
    // Toggling the replacement on/off caused a 1px geometry delta (#1015).
    if (captionBelow || inlineHeader) {
      addHeaderWidgetDecoration(pluginRenderAdapter, div, "", openerSourceActive, macros, items);
    } else {
      addHeaderWidgetDecoration(pluginRenderAdapter, div, spec.header, openerSourceActive, macros, items);
    }

    // Title text: wrap in visual parentheses via widget decorations (rendered mode only).
    // Uses Decoration.widget (not Decoration.mark with CSS ::before/::after) because
    // marks get split around Decoration.replace (math widgets), causing ") $x^2$".
    // For below-caption blocks, title text is the caption — no parens needed.
    if (!openerSourceActive && !captionBelow && !inlineHeader && div.titleFrom !== undefined && div.titleTo !== undefined) {
      addInlineTitleParenDecorations(div.titleFrom, div.titleTo, items);
    }

    if (!openerSourceActive && (captionBelow || inlineHeader) && div.titleFrom !== undefined && div.titleTo !== undefined) {
      items.push(decorationHidden.range(div.titleFrom, div.titleTo));
    }

    // Attribute-only title (not used for below-caption blocks — their title is the caption).
    if (
      !openerSourceActive &&
      !captionBelow &&
      div.titleFrom === undefined &&
      div.titleTo === undefined &&
      div.title
    ) {
      addAttributeTitleDecoration(pluginRenderAdapter, div.openFenceTo, div.title, macros, items);
    }

    // --- Closing fence ---
    // Always hidden in rich mode regardless of cursor position (#428).
    // The closing fence is protected from accidental deletion by a
    // transaction filter and skipped by atomicRanges (see below).
    if (div.singleLine) {
      addSingleLineClosingFence(state, div.closeFenceFrom, div.closeFenceTo, items);
    } else {
      hideMultiLineClosingFence(div.closeFenceFrom, div.closeFenceTo, items);

      // Embed blocks: replace body content with iframe widget
      if (isEmbed && !openerSourceActive) {
        const openLine = state.doc.lineAt(div.openFenceFrom);
        addEmbedWidget(pluginRenderAdapter, state, div, openLine, items, activeShell);
      }
    }

    // Body lines: apply block-type class for per-type styling (italic, etc.)
    if (!div.singleLine) {
      const openLine = state.doc.lineAt(div.from);
      const closeFrom = div.closeFenceFrom >= 0 ? div.closeFenceFrom : div.to;
      const closeLine = state.doc.lineAt(closeFrom);
      for (let lineNum = openLine.number + 1; lineNum < closeLine.number; lineNum++) {
        const line = state.doc.line(lineNum);
        items.push(
          Decoration.line({
            class: joinClasses(
              spec.className,
              activeShell && CSS.activeShell,
              activeShell && !openerLineVisible && lineNum === openLine.number + 1 && CSS.activeShellTop,
              activeShell && !bottomOnCaption && lineNum === closeLine.number - 1 && CSS.activeShellBottom,
            ),
          }).range(line.from),
        );
      }

      if (inlineHeader && !openerSourceActive && closeLine.number > openLine.number + 1) {
        const firstBodyLine = state.doc.line(openLine.number + 1);
        addInlineHeaderDecoration(
          pluginRenderAdapter,
          div,
          firstBodyLine.from,
          spec.header,
          spec.className,
          macros,
          items,
        );
      }

      // Below-caption label: add a real caption block after the content.
      if (captionBelow && !openerSourceActive && closeLine.number > openLine.number + 1) {
        const lastBodyLine = state.doc.line(closeLine.number - 1);
        addCaptionDecoration(
          pluginRenderAdapter,
          div,
          lastBodyLine.to,
          spec.header,
          div.title ?? "",
          macros,
          activeShell,
          items,
        );
      }
    }

    // QED tombstone for blocks with "qed" special behavior (closing fence is always hidden)
    if (plugin.specialBehavior === "qed") {
      addQedDecoration(state, div, items);
    }
  });

  return baseDecos;
}

function activeShellStartsChanged(tr: Transaction): boolean {
  const before = activeFencedOpenFenceStarts(tr.startState);
  const after = activeFencedOpenFenceStarts(tr.state);
  if (before.size !== after.size) return true;
  for (const start of before) {
    if (!after.has(start)) return true;
  }
  return false;
}

function fencedDivsRevisionChanged(tr: Transaction): boolean {
  const before = tr.startState.field(documentSemanticsField, false);
  const after = tr.state.field(documentSemanticsField, false);
  if (!before || !after) return false;
  return (
    getDocumentAnalysisSliceRevision(before, "fencedDivs")
    !== getDocumentAnalysisSliceRevision(after, "fencedDivs")
  );
}

function blockDecorationInputsChanged(tr: Transaction): boolean {
  if (hasStructureEditEffect(tr)) return true;
  if (fencedDivsRevisionChanged(tr)) return true;
  if (tr.startState.field(pluginRegistryField, false) !== tr.state.field(pluginRegistryField, false)) {
    return true;
  }
  if (tr.startState.field(blockCounterField, false) !== tr.state.field(blockCounterField, false)) {
    return true;
  }
  return tr.startState.field(mathMacrosField, false) !== tr.state.field(mathMacrosField, false);
}

/**
 * CM6 StateField that provides block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) and
 * mark decorations are permitted by CM6.
 */
const blockDecorationField = createFencedBlockDecorationField(buildBlockDecorations, {
  extraShouldRebuild: blockDecorationInputsChanged,
  selectionShouldRebuild: activeShellStartsChanged,
});

/** Exported for unit testing decoration logic without a browser. */
export { blockDecorationField as _blockDecorationFieldForTest, blockDecorationInputsChanged as _blockDecorationInputsChangedForTest };

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  documentSemanticsField,
  editorFocusField,
  focusTracker,
  blockDecorationField,
  fenceProtectionExtension,
];
