/**
 * CM6 ViewPlugin that renders fenced divs using the block plugin system.
 *
 * For each FencedDiv node in the syntax tree:
 * - If a plugin is registered for its class, render using the plugin's
 *   render function (Typora-style: show rendered block, reveal ::: on focus).
 * - If no plugin is registered, render as a plain styled div.
 */

import {
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  Decoration,
  WidgetType,
  type EditorView,
} from "@codemirror/view";
import { type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { parseFencedDivAttrs } from "../parser/fenced-div-attrs";
import type { BlockAttrs, BlockDecorationSpec } from "./plugin-types";
import { pluginRegistryField, getPlugin } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import { buildDecorations, cursorInRange } from "../render/render-utils";

/** Widget for the rendered block header (e.g. "Theorem 1 (Main Result)"). */
export class BlockHeaderWidget extends WidgetType {
  constructor(
    private readonly spec: BlockDecorationSpec,
  ) {
    super();
  }

  toDOM(): HTMLElement {
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
export class PlainDivHeaderWidget extends WidgetType {
  constructor(
    private readonly className: string,
    private readonly title: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
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
  readonly className: string;
  readonly id?: string;
  readonly title?: string;
}

/** Extract info about FencedDiv nodes from the syntax tree. */
function collectFencedDivs(view: EditorView): FencedDivInfo[] {
  const results: FencedDivInfo[] = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      if (node.type.name !== "FencedDiv") return;

      const divNode = node.node;
      let className: string | undefined;
      let id: string | undefined;
      let title: string | undefined;
      let fenceFrom = node.from;
      let fenceTo = node.from;

      // Find the first FencedDivFence (opening fence line)
      const fence = divNode.getChild("FencedDivFence");
      if (fence) {
        fenceFrom = fence.from;
        fenceTo = fence.to;
      }

      const attrNode = divNode.getChild("FencedDivAttributes");
      if (attrNode) {
        const attrText = view.state.doc.sliceString(attrNode.from, attrNode.to);
        const attrs = parseFencedDivAttrs(attrText);
        if (attrs && attrs.classes.length > 0) {
          className = attrs.classes[0];
          id = attrs.id;
        }
        fenceTo = Math.max(fenceTo, attrNode.to);
      }

      const titleNode = divNode.getChild("FencedDivTitle");
      if (titleNode) {
        title = view.state.doc.sliceString(titleNode.from, titleNode.to).trim();
        fenceTo = Math.max(fenceTo, titleNode.to);
      }

      if (className) {
        results.push({
          from: node.from,
          to: node.to,
          fenceFrom,
          fenceTo,
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
function buildBlockDecorations(view: EditorView): DecorationSet {
  const registry = view.state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    view.state.field(blockCounterField, false) ?? undefined;
  const divs = collectFencedDivs(view);
  const items: Range<Decoration>[] = [];

  for (const div of divs) {
    // Skip decorating if cursor is inside the fenced div
    if (cursorInRange(view, div.from, div.to)) continue;

    const plugin = getPlugin(registry, div.className);

    if (plugin) {
      // Registered plugin — use its render function
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
      items.push(
        Decoration.replace({
          widget: new BlockHeaderWidget(spec),
        }).range(div.fenceFrom, div.fenceTo),
      );
    } else {
      // Unrecognized class — render as a plain styled div
      items.push(
        Decoration.line({ class: "cg-block cg-block-unknown" }).range(div.from),
      );

      if (div.title) {
        items.push(
          Decoration.replace({
            widget: new PlainDivHeaderWidget(div.className, div.title),
          }).range(div.fenceFrom, div.fenceTo),
        );
      }
    }
  }

  return buildDecorations(items);
}

class BlockRenderPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildBlockDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged
    ) {
      this.decorations = buildBlockDecorations(update.view);
    }
  }
}

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = ViewPlugin.fromClass(
  BlockRenderPlugin,
  {
    decorations: (v) => v.decorations,
  },
);
