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

import { EditorState, type Extension, type Transaction } from "@codemirror/state";
import {
  type DecorationSet,
} from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { activeFencedOpenFenceStarts } from "../state/shell-ownership";
import {
  hasStructureEditEffect,
  isFencedStructureEditActive,
} from "../state/cm-structure-edit";
import { createChangeChecker } from "../state/change-detection";
import { collectFencedDivs, docChangeTouchesFencedDivStructure } from "../fenced-block/model";
import { mathMacrosField } from "../state/math-macros";
import {
  addSingleLineClosingFence,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  editorFocusField,
  focusTracker,
  hideMultiLineClosingFence,
} from "./render-core";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import { type BlockCounterState, blockCounterField } from "../state/block-counter";
import { pluginRegistryField } from "../state/plugin-registry";
import { DecorationBuilder } from "../plugins/decoration-builder";
import { fenceProtectionExtension } from "../plugins/fence-protection";
import { getPluginOrFallback } from "../state/plugin-registry-core";
import {
  addAttributeTitleDecoration,
  addCaptionDecoration,
  addHeaderWidgetDecoration,
  addInlineHeaderDecoration,
  addInlineTitleParenDecorations,
  codeMirrorPluginRenderAdapter as pluginRenderAdapter,
} from "./plugin-adapters/chrome";
import type { BlockAttrs } from "../state/block-plugin";
import { applySpecialBehavior } from "../plugins/special-behavior-handlers";

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function sameNumberSet(
  before: ReadonlySet<number>,
  after: ReadonlySet<number>,
): boolean {
  if (before.size !== after.size) return false;
  for (const value of before) {
    if (!after.has(value)) return false;
  }
  return true;
}

function getFencedDivRenderRevision(state: EditorState): number {
  const semantics = state.field(documentSemanticsField, false);
  return semantics ? getDocumentAnalysisSliceRevision(semantics, "fencedDivs") : -1;
}

function getBlockCounterSignature(state: EditorState): string {
  return state.field(blockCounterField, false)?.numberingKey ?? "";
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
    const builder = new DecorationBuilder(items);
    const plugin = getPluginOrFallback(registry, div.className);

    if (!plugin) return;

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
    builder.addLine(div.from, headerClass);
    // Always keep the widget replacement active — structure editing uses
    // explicit mapped state, not raw-text editing of the fence syntax.
    // Toggling the replacement on/off caused a 1px geometry delta (#1015).
    if (captionBelow || inlineHeader) {
      addHeaderWidgetDecoration(
        pluginRenderAdapter,
        div,
        "",
        openerSourceActive,
        macros,
        items,
      );
    } else {
      addHeaderWidgetDecoration(
        pluginRenderAdapter,
        div,
        spec.header,
        openerSourceActive,
        macros,
        items,
      );
    }

    // Title text: wrap in visual parentheses via widget decorations (rendered mode only).
    // Uses Decoration.widget (not Decoration.mark with CSS ::before/::after) because
    // marks get split around Decoration.replace (math widgets), causing ") $x^2$".
    // For below-caption blocks, title text is the caption — no parens needed.
    if (!openerSourceActive && !captionBelow && !inlineHeader && div.titleFrom !== undefined && div.titleTo !== undefined) {
      addInlineTitleParenDecorations(div.titleFrom, div.titleTo, items);
    }

    if (!openerSourceActive && (captionBelow || inlineHeader) && div.titleFrom !== undefined && div.titleTo !== undefined) {
      builder.addHidden(div.titleFrom, div.titleTo);
    }

    // Attribute-only title (not used for below-caption blocks — their title is the caption).
    if (
      !openerSourceActive &&
      !captionBelow &&
      div.titleFrom === undefined &&
      div.titleTo === undefined &&
      div.title
    ) {
      addAttributeTitleDecoration(
        pluginRenderAdapter,
        div.openFenceTo,
        div.title,
        macros,
        items,
        div.titleSourceFrom,
        div.titleSourceTo,
      );
    }

    // --- Closing fence ---
    // Always hidden in rich mode regardless of cursor position (#428).
    // The closing fence is protected from accidental deletion by a
    // transaction filter and skipped by atomicRanges (see below).
    if (div.singleLine) {
      addSingleLineClosingFence(state, div.closeFenceFrom, div.closeFenceTo, items);
    } else {
      hideMultiLineClosingFence(div.closeFenceFrom, div.closeFenceTo, items);
      plugin.renderDecorations?.addBodyDecorations?.({
        adapter: pluginRenderAdapter,
        state,
        div,
        items,
        activeShell,
        openerSourceActive,
      });
    }

    // Body lines: apply block-type class for per-type styling (italic, etc.)
    if (!div.singleLine) {
      const closeFrom = div.closeFenceFrom >= 0 ? div.closeFenceFrom : div.to;
      const bodyCloseLine = state.doc.lineAt(closeFrom);
      for (let lineNum = openLine.number + 1; lineNum < bodyCloseLine.number; lineNum++) {
        const line = state.doc.line(lineNum);
        builder.addLine(
          line.from,
          joinClasses(
            spec.className,
            activeShell && CSS.activeShell,
            activeShell && !openerLineVisible && lineNum === openLine.number + 1 && CSS.activeShellTop,
            activeShell && !bottomOnCaption && lineNum === bodyCloseLine.number - 1 && CSS.activeShellBottom,
          ),
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

    applySpecialBehavior(plugin.specialBehavior, {
      state,
      div,
      builder,
      openLine,
      activeShell,
      openerSourceActive,
    });
  });

  return baseDecos;
}

const activeShellStartsChanged = createChangeChecker({
  get: activeFencedOpenFenceStarts,
  equals: sameNumberSet,
});

const fencedDivRenderRevisionChanged = createChangeChecker(getFencedDivRenderRevision);

const blockDecorationDependencyChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField, false),
  getBlockCounterSignature,
  (state) => state.field(mathMacrosField, false),
);

function blockDecorationInputsChanged(tr: Transaction): boolean {
  return hasStructureEditEffect(tr)
    || (
      fencedDivRenderRevisionChanged(tr)
      && (!tr.docChanged || docChangeTouchesFencedDivStructure(tr))
    )
    || blockDecorationDependencyChanged(tr);
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
  rebuildOnTreeChange: false,
});

/** Exported for unit testing decoration logic without a browser. */
export {
  blockDecorationField as _blockDecorationFieldForTest,
  blockDecorationInputsChanged as _blockDecorationInputsChangedForTest,
};

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  documentSemanticsField,
  editorFocusField,
  focusTracker,
  blockDecorationField,
  fenceProtectionExtension,
];
