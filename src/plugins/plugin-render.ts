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

import {
  type DecorationSet,
  Decoration,
  EditorView,
} from "@codemirror/view";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { parseFencedDivAttrs } from "../parser/fenced-div-attrs";
import type { BlockAttrs } from "./plugin-types";
import { pluginRegistryField, getPlugin } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import {
  cursorContainedIn,
  buildDecorations,
  decorationHidden,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "../render/render-utils";

interface FencedDivInfo {
  readonly from: number;
  readonly to: number;
  readonly fenceFrom: number;
  readonly fenceTo: number;
  readonly attrFrom?: number;
  readonly attrTo?: number;
  readonly titleFrom?: number;
  readonly titleTo?: number;
  readonly closeFenceFrom: number;
  readonly closeFenceTo: number;
  readonly className: string;
  readonly id?: string;
  readonly title?: string;
}

/** Extract info about FencedDiv nodes from the syntax tree. */
function collectFencedDivs(state: EditorState): FencedDivInfo[] {
  const results: FencedDivInfo[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.type.name !== "FencedDiv") return;

      const divNode = node.node;
      let className: string | undefined;
      let id: string | undefined;
      let title: string | undefined;
      let fenceFrom = node.from;
      let fenceTo = node.from;
      let attrFrom: number | undefined;
      let attrTo: number | undefined;
      let titleFrom: number | undefined;
      let titleTo: number | undefined;
      let closeFenceFrom = -1;
      let closeFenceTo = -1;

      // Collect all FencedDivFence children (opening + closing)
      const fences = divNode.getChildren("FencedDivFence");
      if (fences.length > 0) {
        fenceFrom = fences[0].from;
        fenceTo = fences[0].to;
      }
      if (fences.length > 1) {
        const lastFence = fences[fences.length - 1];
        // Extend to the full line of the closing fence
        const closeLine = state.doc.lineAt(lastFence.from);
        closeFenceFrom = closeLine.from;
        closeFenceTo = closeLine.to;
      }

      const attrNode = divNode.getChild("FencedDivAttributes");
      if (attrNode) {
        const attrText = state.doc.sliceString(attrNode.from, attrNode.to);
        const attrs = parseFencedDivAttrs(attrText);
        if (attrs && attrs.classes.length > 0) {
          className = attrs.classes[0];
          id = attrs.id;
        }
        attrFrom = attrNode.from;
        attrTo = attrNode.to;
        fenceTo = Math.max(fenceTo, attrNode.to);
      }

      const titleNode = divNode.getChild("FencedDivTitle");
      if (titleNode) {
        title = state.doc.sliceString(titleNode.from, titleNode.to).trim();
        titleFrom = titleNode.from;
        titleTo = titleNode.to;
        fenceTo = Math.max(fenceTo, titleNode.to);
      }

      if (className) {
        results.push({
          from: node.from,
          to: node.to,
          fenceFrom,
          fenceTo,
          attrFrom,
          attrTo,
          titleFrom,
          titleTo,
          closeFenceFrom,
          closeFenceTo,
          className,
          id,
          title,
        });
      }
    },
  });

  return results;
}

/** Add hiding marks for fence syntax (opening prefix, attributes, closing fence). */
function hideFenceSyntax(div: FencedDivInfo, items: Range<Decoration>[]): void {
  // Hide the opening fence colons (the "::: " prefix)
  if (div.attrFrom !== undefined && div.attrFrom > div.fenceFrom) {
    items.push(decorationHidden.range(div.fenceFrom, div.attrFrom));
  } else if (div.titleFrom !== undefined && div.titleFrom > div.fenceFrom) {
    items.push(decorationHidden.range(div.fenceFrom, div.titleFrom));
  } else {
    items.push(decorationHidden.range(div.fenceFrom, div.fenceTo));
  }

  // Hide the attributes block (e.g. "{.theorem #thm-main}")
  if (div.attrFrom !== undefined && div.attrTo !== undefined) {
    if (div.titleFrom !== undefined && div.titleFrom > div.attrTo) {
      // Hide attr + space before title
      items.push(decorationHidden.range(div.attrFrom, div.titleFrom));
    } else {
      items.push(decorationHidden.range(div.attrFrom, div.attrTo));
    }
  }

  // Hide closing fence line
  if (div.closeFenceFrom >= 0 && div.closeFenceTo >= div.closeFenceFrom) {
    items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
  }
}

/** Build decorations for all fenced divs using the plugin registry. */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const focused = state.field(editorFocusField, false) ?? false;
  const divs = collectFencedDivs(state);
  const items: Range<Decoration>[] = [];

  for (const div of divs) {
    // Expand range: full lines of the block + one extra line after closing fence.
    const blockLineFrom = state.doc.lineAt(div.from).from;
    const closingLine = state.doc.lineAt(div.to);
    const blockLineTo = closingLine.number < state.doc.lines
      ? state.doc.line(closingLine.number + 1).to
      : closingLine.to;
    const cursorInside = focused && cursorContainedIn(state, blockLineFrom, blockLineTo);

    const plugin = getPlugin(registry, div.className);

    // In source mode (cursor inside), show raw markdown — no hiding decorations.
    // Only add the block wrapper class for subtle styling.
    if (cursorInside) {
      if (plugin) {
        items.push(
          Decoration.line({ class: `${plugin.render({ type: div.className }).className} cg-block-source` }).range(div.from),
        );
      }
      continue;
    }

    // Rendered mode: add line decoration, then hide fence syntax.
    if (plugin) {
      const numberEntry = counterState?.byPosition.get(div.from);
      const blockAttrs: BlockAttrs = {
        type: div.className,
        id: div.id,
        title: div.title,
        number: numberEntry?.number,
      };
      const spec = plugin.render(blockAttrs);

      // Line decoration on the opening fence line: block class + label
      items.push(
        Decoration.line({
          class: `${spec.className} cg-block-header`,
          attributes: { "data-block-label": spec.header },
        }).range(div.from),
      );
    } else {
      // Unrecognized class -- render as a plain styled div
      items.push(
        Decoration.line({
          class: "cg-block cg-block-unknown cg-block-header",
          attributes: div.title ? { "data-block-label": div.title } : {},
        }).range(div.from),
      );
    }

    // Hide fence syntax (shared for both plugin and plain divs)
    hideFenceSyntax(div, items);
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) and
 * mark decorations are permitted by CM6.
 */
const blockDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecorations(state);
  },

  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(focusEffect))) {
      return buildBlockDecorations(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  blockDecorationField,
];
