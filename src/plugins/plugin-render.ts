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
  WidgetType,
} from "@codemirror/view";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { extractDivClass } from "../parser/fenced-div-attrs";
import type { BlockAttrs } from "./plugin-types";
import { pluginRegistryField, getPluginOrFallback } from "./plugin-registry";
import { blockCounterField, type BlockCounterState } from "./block-counter";
import {
  buildDecorations,
  decorationHidden,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "../render/render-utils";
import { getMathMacros } from "../render/math-macros";
import { MathWidget, renderKatex } from "../render/math-render";

/** Split text by $...$ inline math, returning alternating text/math segments. */
function splitByInlineMath(
  text: string,
): Array<{ isMath: boolean; content: string }> {
  const segments: Array<{ isMath: boolean; content: string }> = [];
  const regex = /\$([^$\n]+)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ isMath: false, content: text.slice(lastIndex, match.index) });
    }
    segments.push({ isMath: true, content: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ isMath: false, content: text.slice(lastIndex) });
  }

  return segments;
}

/** Widget that renders a block header string with optional inline KaTeX math. */
class BlockHeaderWidget extends WidgetType {
  constructor(
    private readonly header: string,
    private readonly macros: Record<string, string>,
    private readonly macrosKey: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cg-block-header-rendered";

    for (const seg of splitByInlineMath(this.header)) {
      if (!seg.isMath) {
        el.appendChild(document.createTextNode(seg.content));
      } else {
        const mathEl = document.createElement("span");
        renderKatex(mathEl, seg.content, false, this.macros);
        el.appendChild(mathEl);
      }
    }

    return el;
  }

  eq(other: BlockHeaderWidget): boolean {
    return this.header === other.header && this.macrosKey === other.macrosKey;
  }

  ignoreEvent(): boolean {
    // Let CM6 handle clicks → places cursor at fenceFrom → reveals source
    return false;
  }
}

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
        const attrs = extractDivClass(attrText);
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


/** Build decorations for all fenced divs using the plugin registry. */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const focused = state.field(editorFocusField, false) ?? false;
  const divs = collectFencedDivs(state);
  const items: Range<Decoration>[] = [];

  const macros = getMathMacros(state);
  const macrosKey =
    Object.keys(macros).length > 0
      ? Object.keys(macros)
          .sort()
          .map((k) => `${k}=${macros[k]}`)
          .join("\0")
      : "";

  for (const div of divs) {
    const plugin = getPluginOrFallback(registry, div.className);
    const isInclude = div.className === "include";

    // Include blocks are always invisible — content flows seamlessly
    if (isInclude) {
      // Hide the entire opening fence line
      items.push(decorationHidden.range(div.fenceFrom, div.fenceTo));
      if (div.attrFrom !== undefined && div.attrTo !== undefined) {
        items.push(decorationHidden.range(div.attrFrom, div.attrTo));
      }
      if (div.titleFrom !== undefined && div.titleTo !== undefined) {
        items.push(decorationHidden.range(div.titleFrom, div.titleTo));
      }
      // Hide closing fence
      if (div.closeFenceFrom >= 0 && div.closeFenceTo >= div.closeFenceFrom) {
        items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
      }
      // Collapse fence lines to zero height
      items.push(
        Decoration.line({ class: "cg-include-fence" }).range(div.fenceFrom),
      );
      if (div.closeFenceFrom >= 0) {
        items.push(
          Decoration.line({ class: "cg-include-fence" }).range(div.closeFenceFrom),
        );
      }
      continue;
    }

    // Check if cursor is on a fence line (opening or closing).
    // Fences are a semantic pair — editing one should reveal both.
    const cursor = state.selection.main;
    const openLine = state.doc.lineAt(div.fenceFrom);
    const cursorOnOpenFence =
      focused && cursor.from >= openLine.from && cursor.from <= openLine.to;
    const cursorOnCloseFence =
      focused &&
      div.closeFenceFrom >= 0 &&
      cursor.from >= div.closeFenceFrom &&
      cursor.from <= div.closeFenceTo;
    const cursorOnFence = cursorOnOpenFence || cursorOnCloseFence;

    if (!cursorOnFence && plugin) {
      const numberEntry = counterState?.byPosition.get(div.from);
      // Build label without title — title stays as editable text
      const labelAttrs: BlockAttrs = {
        type: div.className,
        id: div.id,
        number: numberEntry?.number,
      };
      const spec = plugin.render(labelAttrs);

      // Line decoration for block CSS class
      items.push(
        Decoration.line({
          class: `${spec.className} cg-block-header`,
        }).range(div.from),
      );

      // Replace fence+attrs with label widget, title stays as editable text
      const replaceEnd = div.titleFrom ?? div.fenceTo;
      const label = div.titleFrom !== undefined ? spec.header + " " : spec.header;
      items.push(
        Decoration.replace({
          widget: new BlockHeaderWidget(label, macros, macrosKey),
        }).range(div.fenceFrom, replaceEnd),
      );

      // Hide closing fence
      if (div.closeFenceFrom >= 0 && div.closeFenceTo >= div.closeFenceFrom) {
        items.push(decorationHidden.range(div.closeFenceFrom, div.closeFenceTo));
      }
    } else if (plugin) {
      // Cursor on fence: show fence syntax as source, title stays as editable text
      items.push(
        Decoration.line({
          class: `${plugin.render({ type: div.className }).className} cg-block-source`,
        }).range(div.from),
      );
    }

    // Render inline math ($...$) in title text (Typora-style: cursor inside → source)
    if (div.titleFrom !== undefined && div.titleTo !== undefined) {
      const titleText = state.sliceDoc(div.titleFrom, div.titleTo);
      const regex = /\$([^$\n]+)\$/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(titleText)) !== null) {
        const mathFrom = div.titleFrom + match.index;
        const mathTo = mathFrom + match[0].length;
        if (focused && cursor.from >= mathFrom && cursor.from <= mathTo) continue;
        const widget = new MathWidget(match[1], match[0], false, macros);
        items.push(Decoration.replace({ widget }).range(mathFrom, mathTo));
      }
    }

    // QED tombstone: add right-aligned ∎ on the last content line of proof blocks
    if (plugin && plugin.defaults?.qedSymbol && div.closeFenceFrom >= 0) {
      const closeLine = state.doc.lineAt(div.closeFenceFrom);
      if (closeLine.number > 1) {
        const lastContentLine = state.doc.line(closeLine.number - 1);
        if (lastContentLine.from > div.fenceFrom) {
          items.push(
            Decoration.line({ class: "cg-block-qed" }).range(lastContentLine.from),
          );
        }
      }
    }
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
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect)) ||
      syntaxTree(tr.state).length > syntaxTree(tr.startState).length
    ) {
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
