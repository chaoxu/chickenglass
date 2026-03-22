/**
 * Debug inspector overlay (Cmd+Shift+D).
 *
 * When active, decorates all syntax nodes with colored outlines:
 * - Blue: inline (Emphasis, StrongEmphasis, InlineCode, Strikethrough, Highlight)
 * - Green: math (InlineMath, DisplayMath)
 * - Orange: blocks (FencedDiv, FencedCode)
 * - Purple: links (Link, Image)
 * - Red: headings (ATXHeading1-6)
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import {
  type Extension,
  type Range,
  StateEffect,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { createBooleanToggleField } from "./render-utils";

/** Effect to toggle the debug inspector on/off. */
const toggleDebugEffect = StateEffect.define<boolean>();

/** StateField tracking whether the debug inspector is active. */
const debugActiveField = createBooleanToggleField(toggleDebugEffect);

/** Color categories for syntax node types. */
const INLINE_NODES = new Set([
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Strikethrough",
  "Highlight",
]);

const MATH_NODES = new Set(["InlineMath", "DisplayMath"]);

const BLOCK_NODES = new Set(["FencedDiv", "FencedCode"]);

const LINK_NODES = new Set(["Link", "Image"]);

function isHeading(name: string): boolean {
  return name.startsWith("ATXHeading") && name.length <= 12;
}

/** Create a decoration mark with a colored outline. */
function outlineDecoration(color: string): Decoration {
  return Decoration.mark({
    attributes: {
      style: `outline: 1px solid ${color}; outline-offset: -1px;`,
    },
  });
}

const blueOutline = outlineDecoration("blue");
const greenOutline = outlineDecoration("green");
const orangeOutline = outlineDecoration("orange");
const purpleOutline = outlineDecoration("purple");
const redOutline = outlineDecoration("red");

function getOutlineDecoration(name: string): Decoration | null {
  if (INLINE_NODES.has(name)) return blueOutline;
  if (MATH_NODES.has(name)) return greenOutline;
  if (BLOCK_NODES.has(name)) return orangeOutline;
  if (LINK_NODES.has(name)) return purpleOutline;
  if (isHeading(name)) return redOutline;
  return null;
}

class DebugInspectorPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.startState.field(debugActiveField) !==
        update.state.field(debugActiveField) ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.decorations = this.build(update.view);
    }
  }

  private build(view: EditorView): DecorationSet {
    const active = view.state.field(debugActiveField);
    if (!active) return Decoration.none;

    const widgets: Range<Decoration>[] = [];

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter(node) {
          const deco = getOutlineDecoration(node.name);
          if (deco) {
            widgets.push(deco.range(node.from, node.to));
          }
        },
      });
    }

    return Decoration.set(widgets, true);
  }
}

/** Command that toggles the debug inspector. */
export function toggleDebugInspector(view: EditorView): boolean {
  const current = view.state.field(debugActiveField);
  view.dispatch({ effects: toggleDebugEffect.of(!current) });
  return true;
}

/** CM6 extension providing the debug inspector overlay. */
export const debugInspectorPlugin: Extension = [
  debugActiveField,
  ViewPlugin.fromClass(DebugInspectorPlugin, {
    decorations: (v) => v.decorations,
  }),
];
