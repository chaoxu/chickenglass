import { EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { EXCLUDED_FROM_FALLBACK } from "../constants/block-manifest";
import { CSS } from "../constants/css-classes";
import { activeFencedOpenFenceStarts } from "../editor/shell-ownership";
import { isFencedStructureEditActive } from "../editor/structure-edit-state";
import {
  collectFencedDivs,
  type FencedDivInfo,
} from "../fenced-block/model";
import {
  addSingleLineClosingFence,
  buildFencedBlockDecorations,
  decorationHidden,
  mathMacrosField,
  hideMultiLineClosingFence,
} from "../render/render-core";
import { type BlockCounterState, blockCounterField } from "./block-counter";
import { getPluginOrFallback, pluginRegistryField } from "./plugin-registry";
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

function addIncludeDecorations(
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  items.push(decorationHidden.range(div.openFenceFrom, div.openFenceTo));
  if (div.attrFrom !== undefined && div.attrTo !== undefined) {
    items.push(decorationHidden.range(div.attrFrom, div.attrTo));
  }
  if (div.titleFrom !== undefined && div.titleTo !== undefined) {
    items.push(decorationHidden.range(div.titleFrom, div.titleTo));
  }
  if (div.closeFenceFrom >= 0 && div.closeFenceTo > div.closeFenceFrom) {
    items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
  }
  items.push(
    Decoration.line({ class: CSS.includeFence }).range(div.openFenceFrom),
  );
  if (div.closeFenceFrom >= 0) {
    items.push(
      Decoration.line({ class: CSS.includeFence }).range(div.closeFenceFrom),
    );
  }
}

function addQedDecoration(
  state: EditorState,
  div: FencedDivInfo,
  items: Range<Decoration>[],
): void {
  if (div.closeFenceFrom < 0) return;

  const closeLine = state.doc.lineAt(div.closeFenceFrom);
  if (closeLine.number <= 1) return;

  const lastContentLine = state.doc.line(closeLine.number - 1);
  if (lastContentLine.from <= div.openFenceFrom) return;
  items.push(
    Decoration.line({ class: CSS.blockQed }).range(lastContentLine.from),
  );
}

export function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const macros = state.field(mathMacrosField);
  const activeShellStarts = activeFencedOpenFenceStarts(state);

  return buildFencedBlockDecorations(state, collectFencedDivs, ({
    state,
    block: div,
    openLine,
    closeLine,
  }, items) => {
    const plugin = getPluginOrFallback(registry, div.className);

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
    addHeaderWidgetDecoration(
      div,
      captionBelow || inlineHeader ? "" : spec.header,
      openerSourceActive,
      macros,
      items,
    );

    if (
      !openerSourceActive &&
      !captionBelow &&
      !inlineHeader &&
      div.titleFrom !== undefined &&
      div.titleTo !== undefined
    ) {
      addInlineTitleParenDecorations(div.titleFrom, div.titleTo, items);
    }

    if (
      !openerSourceActive &&
      (captionBelow || inlineHeader) &&
      div.titleFrom !== undefined &&
      div.titleTo !== undefined
    ) {
      items.push(decorationHidden.range(div.titleFrom, div.titleTo));
    }

    if (
      !openerSourceActive &&
      !captionBelow &&
      div.titleFrom === undefined &&
      div.titleTo === undefined &&
      div.title
    ) {
      addAttributeTitleDecoration(div.openFenceTo, div.title, macros, items);
    }

    if (div.singleLine) {
      addSingleLineClosingFence(state, div.closeFenceFrom, div.closeFenceTo, items);
    } else {
      hideMultiLineClosingFence(div.closeFenceFrom, div.closeFenceTo, items);
      if (isEmbed && !openerSourceActive) {
        const embedOpenLine = state.doc.lineAt(div.openFenceFrom);
        addEmbedWidget(state, div, embedOpenLine, items, activeShell);
      }
    }

    if (!div.singleLine) {
      const bodyOpenLine = state.doc.lineAt(div.from);
      const closeFrom = div.closeFenceFrom >= 0 ? div.closeFenceFrom : div.to;
      const bodyCloseLine = state.doc.lineAt(closeFrom);
      for (let lineNum = bodyOpenLine.number + 1; lineNum < bodyCloseLine.number; lineNum++) {
        const line = state.doc.line(lineNum);
        items.push(
          Decoration.line({
            class: joinClasses(
              spec.className,
              activeShell && CSS.activeShell,
              activeShell && !openerLineVisible && lineNum === bodyOpenLine.number + 1 && CSS.activeShellTop,
              activeShell && !bottomOnCaption && lineNum === bodyCloseLine.number - 1 && CSS.activeShellBottom,
            ),
          }).range(line.from),
        );
      }

      if (inlineHeader && !openerSourceActive && bodyCloseLine.number > bodyOpenLine.number + 1) {
        const firstBodyLine = state.doc.line(bodyOpenLine.number + 1);
        addInlineHeaderDecoration(
          div,
          firstBodyLine.from,
          spec.header,
          spec.className,
          macros,
          items,
        );
      }

      if (captionBelow && !openerSourceActive && bodyCloseLine.number > bodyOpenLine.number + 1) {
        const lastBodyLine = state.doc.line(bodyCloseLine.number - 1);
        addCaptionDecoration(
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

    if (plugin.specialBehavior === "qed") {
      addQedDecoration(state, div, items);
    }
  });
}
