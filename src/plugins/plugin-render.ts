/**
 * CM6 decoration provider for rendering fenced divs using the block plugin system.
 *
 * For each FencedDiv node in the syntax tree:
 * - If a plugin is registered for its class, render using the plugin's
 *   render function (Typora-style: show rendered block, reveal ::: on focus).
 * - If no plugin is registered, render as a plain styled div.
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
import type { BlockAttrs, BlockDecorationSpec } from "./plugin-types";
import { pluginRegistryField, getPlugin } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import {
  cursorContainedIn,
  buildDecorations,
  RenderWidget,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "../render/render-utils";

/** Widget for the rendered block header (e.g. "Theorem 1 (Main Result)"). */
export class BlockHeaderWidget extends RenderWidget {
  constructor(
    private readonly spec: BlockDecorationSpec,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `${this.spec.className}-header`;
    const strong = document.createElement("strong");
    strong.textContent = this.spec.header;
    el.appendChild(strong);
    return el;
  }

  eq(other: BlockHeaderWidget): boolean {
    return (
      this.spec.className === other.spec.className &&
      this.spec.header === other.spec.header
    );
  }
}

/** Widget for an unrecognized fenced div (plain styled div). */
export class PlainDivHeaderWidget extends RenderWidget {
  constructor(
    private readonly className: string,
    private readonly title: string,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cg-block cg-block-unknown-header";
    if (this.title) {
      const strong = document.createElement("strong");
      strong.textContent = this.title;
      el.appendChild(strong);
    }
    return el;
  }

  eq(other: PlainDivHeaderWidget): boolean {
    return this.className === other.className && this.title === other.title;
  }
}

interface FencedDivInfo {
  readonly from: number;
  readonly to: number;
  readonly fenceFrom: number;
  readonly fenceTo: number;
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
        fenceTo = Math.max(fenceTo, attrNode.to);
      }

      const titleNode = divNode.getChild("FencedDivTitle");
      if (titleNode) {
        title = state.doc.sliceString(titleNode.from, titleNode.to).trim();
        fenceTo = Math.max(fenceTo, titleNode.to);
      }

      if (className) {
        results.push({
          from: node.from,
          to: node.to,
          fenceFrom,
          fenceTo,
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

/** Build decorations for all fenced divs using the plugin registry. */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const focused = state.field(editorFocusField, false) ?? false;
  const divs = collectFencedDivs(state);
  const items: Range<Decoration>[] = [];

  for (const div of divs) {
    // Skip decorating if the editor is focused and cursor is inside the fenced div
    if (focused && cursorContainedIn(state, div.from, div.to)) continue;

    const plugin = getPlugin(registry, div.className);

    if (plugin) {
      // Registered plugin -- use its render function
      const numberEntry = counterState?.byPosition.get(div.from);
      const blockAttrs: BlockAttrs = {
        type: div.className,
        id: div.id,
        title: div.title,
        number: numberEntry?.number,
      };
      const spec = plugin.render(blockAttrs);

      // Line decoration to wrap the entire block
      items.push(
        Decoration.line({ class: spec.className }).range(div.from),
      );

      // Replace the opening fence line with the rendered header
      const headerWidget = new BlockHeaderWidget(spec);
      items.push(
        Decoration.replace({ widget: headerWidget }).range(div.fenceFrom, div.fenceTo),
      );
    } else {
      // Unrecognized class -- render as a plain styled div
      items.push(
        Decoration.line({ class: "cg-block cg-block-unknown" }).range(div.from),
      );

      if (div.title) {
        const plainWidget = new PlainDivHeaderWidget(div.className, div.title);
        items.push(
          Decoration.replace({ widget: plainWidget }).range(div.fenceFrom, div.fenceTo),
        );
      }
    }

    // Hide the closing fence line
    if (div.closeFenceFrom >= 0 && div.closeFenceTo >= div.closeFenceFrom) {
      items.push(
        Decoration.replace({}).range(div.closeFenceFrom, div.closeFenceTo),
      );
    }
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) and
 * block-level replace decorations are permitted by CM6.
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
    return [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ];
  },
});

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [editorFocusField, focusTracker, blockDecorationField];
