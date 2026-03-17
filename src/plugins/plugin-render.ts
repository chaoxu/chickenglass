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
import { type EditorState, type Extension, type Range, StateField, StateEffect } from "@codemirror/state";
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

/**
 * StateEffect to set which block is actively being edited.
 * Value is the block's `from` position, or -1 to clear.
 */
const activeBlockEffect = StateEffect.define<number>();

/**
 * Tracks which fenced div block is currently being edited (source mode).
 * Once a block enters source mode via widget click, it stays active until
 * the user clicks outside it or on a different block's widget.
 */
const activeBlockField = StateField.define<number>({
  create() {
    return -1;
  },
  update(active, tr) {
    for (const effect of tr.effects) {
      if (effect.is(activeBlockEffect)) return effect.value;
    }
    return active;
  },
});

/** Widget for the rendered block header (e.g. "Theorem 1 (Main Result)"). */
export class BlockHeaderWidget extends RenderWidget {
  /** The FencedDiv's `from` position — used to set the active block on click. */
  blockFrom = -1;

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

  toDOM(view?: EditorView): HTMLElement {
    const el = super.toDOM(view);
    if (view && this.blockFrom >= 0) {
      const blockFrom = this.blockFrom;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.focus();
        view.dispatch({
          selection: { anchor: this.sourceFrom >= 0 ? this.sourceFrom : blockFrom },
          effects: activeBlockEffect.of(blockFrom),
        });
      });
    }
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
  blockFrom = -1;

  constructor(
    private readonly className: string,
    private readonly title: string,
  ) {
    super();
  }

  toDOM(view?: EditorView): HTMLElement {
    const el = super.toDOM(view);
    if (view && this.blockFrom >= 0) {
      const blockFrom = this.blockFrom;
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.focus();
        view.dispatch({
          selection: { anchor: this.sourceFrom >= 0 ? this.sourceFrom : blockFrom },
          effects: activeBlockEffect.of(blockFrom),
        });
      });
    }
    return el;
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

/** Debug colors for block hit-area outlines. */
const DEBUG_COLORS = ["#e74c3c", "#2ecc71", "#3498db", "#f39c12", "#9b59b6", "#1abc9c"];

/** Build decorations for all fenced divs using the plugin registry. */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const focused = state.field(editorFocusField, false) ?? false;
  const activeBlock = state.field(activeBlockField, false) ?? -1;
  const divs = collectFencedDivs(state);
  const items: Range<Decoration>[] = [];

  for (let i = 0; i < divs.length; i++) {
    const div = divs[i];
    // Expand range: full lines of the block + one extra line after closing fence.
    const blockLineFrom = state.doc.lineAt(div.from).from;
    const closingLine = state.doc.lineAt(div.to);
    const blockLineTo = closingLine.number < state.doc.lines
      ? state.doc.line(closingLine.number + 1).to
      : closingLine.to;
    // A block is in source mode if:
    // 1. It was explicitly activated via widget click (activeBlock matches), OR
    // 2. The cursor is inside its expanded range
    const isActiveBlock = activeBlock === div.from;
    const cursorInside = focused && (isActiveBlock || cursorContainedIn(state, blockLineFrom, blockLineTo));
    const color = DEBUG_COLORS[i % DEBUG_COLORS.length];

    // Debug: add colored outline to every line in the hit area
    const startLine = state.doc.lineAt(blockLineFrom).number;
    const endLine = state.doc.lineAt(blockLineTo).number;
    for (let ln = startLine; ln <= endLine; ln++) {
      const lineStart = state.doc.line(ln).from;
      items.push(
        Decoration.line({
          attributes: {
            style: `outline: 2px ${cursorInside ? "solid" : "dashed"} ${color}; outline-offset: -2px; ${cursorInside ? "background: " + color + "11;" : ""}`,
            title: `${div.className} node=[${div.from}-${div.to}] expanded=[${blockLineFrom}-${blockLineTo}] active=${isActiveBlock} contained=${focused && cursorContainedIn(state, blockLineFrom, blockLineTo)} cursor=${cursorInside ? "INSIDE" : "outside"} sel=${state.selection.main.from}`,
          },
        }).range(lineStart),
      );
    }

    // Skip rendering decorations if cursor is inside the block
    if (cursorInside) continue;

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
      headerWidget.sourceFrom = div.fenceFrom;
      headerWidget.blockFrom = div.from;
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
        plainWidget.sourceFrom = div.fenceFrom;
        plainWidget.blockFrom = div.from;
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
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(focusEffect) || e.is(activeBlockEffect))) {
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

/**
 * Listener that clears the active block when the cursor moves outside
 * all fenced div ranges (so source mode is exited).
 */
const activeBlockClearer = EditorView.updateListener.of((update) => {
  if (!update.selectionSet) return;
  const active = update.state.field(activeBlockField, false) ?? -1;
  if (active < 0) return;

  const divs = collectFencedDivs(update.state);
  const cursor = update.state.selection.main;
  for (const div of divs) {
    const lineFrom = update.state.doc.lineAt(div.from).from;
    const closeLine = update.state.doc.lineAt(div.to);
    const lineTo = closeLine.number < update.state.doc.lines
      ? update.state.doc.line(closeLine.number + 1).to
      : closeLine.to;
    if (cursor.from >= lineFrom && cursor.to <= lineTo) return; // still inside a block
  }
  // Cursor is outside all blocks — clear active
  update.view.dispatch({ effects: activeBlockEffect.of(-1) });
});

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  activeBlockField,
  editorFocusField,
  focusTracker,
  blockDecorationField,
  activeBlockClearer,
];
