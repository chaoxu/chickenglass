import { Decoration } from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { createDecorationsField } from "./render-utils";

/**
 * Maps Lezer syntax node type names to HTML tag names.
 * These become `data-tag-name` attributes on `cm-line` elements,
 * enabling CSS selectors like `[data-tag-name="h1"]`.
 */
const TAG_NAME_MAP: Readonly<Record<string, string>> = {
  ATXHeading1: "h1",
  ATXHeading2: "h2",
  ATXHeading3: "h3",
  ATXHeading4: "h4",
  ATXHeading5: "h5",
  ATXHeading6: "h6",
  BulletList: "ul",
  OrderedList: "ol",
  FencedCode: "code",
  HorizontalRule: "hr",
  FencedDiv: "div",
  Paragraph: "p",
};

/**
 * Build a DecorationSet of `Decoration.line` decorations that add
 * `data-tag-name` attributes to each `cm-line` element covered by a
 * block-level syntax node.
 *
 * `Decoration.line` must be applied at the line-start position (from).
 * We iterate over every line that falls within each matching node and
 * apply the decoration to each line's start.
 */
function buildContainerDecorations(state: EditorState) {
  const builder = new RangeSetBuilder<Decoration>();

  // Collect (lineStart, tagName) pairs, deduplicated by position.
  // A line may be covered by multiple nodes (e.g. Paragraph inside FencedDiv).
  // We want the most-specific (innermost) node's tag, so we collect all and
  // sort by node depth — but since we iterate depth-first we need to track
  // which positions we've already assigned.
  const lineTagMap = new Map<number, string>();

  syntaxTree(state).iterate({
    enter(node) {
      const tagName = TAG_NAME_MAP[node.type.name];
      if (!tagName) return;

      // Walk every line that this node spans and assign the tag.
      // Inner nodes will override outer ones because the tree is iterated
      // in document order (outer before inner). We overwrite on each entry,
      // so the last (innermost) assignment wins.
      let lineStart = state.doc.lineAt(node.from).from;
      const nodeEnd = node.to;

      while (lineStart <= nodeEnd) {
        lineTagMap.set(lineStart, tagName);
        const line = state.doc.lineAt(lineStart);
        if (line.to >= nodeEnd) break;
        lineStart = line.to + 1; // next line start
      }
    },
  });

  // Sort positions and build the RangeSet (builder requires sorted order).
  const sortedPositions = [...lineTagMap.keys()].sort((a, b) => a - b);
  for (const pos of sortedPositions) {
    const tagName = lineTagMap.get(pos);
    if (tagName === undefined) continue;
    builder.add(
      pos,
      pos,
      Decoration.line({ attributes: { "data-tag-name": tagName } }),
    );
  }

  return builder.finish();
}

/**
 * StateField that maintains a DecorationSet of `Decoration.line`
 * decorations for all block-level nodes, adding `data-tag-name`
 * attributes to the corresponding `cm-line` DOM elements.
 *
 * Uses `mapOnDocChanged` so that text edits preserving the syntax tree
 * map decoration positions via `value.map(tr.changes)` instead of a
 * full rebuild — enabling CM6's shared-chunk RangeSet shortcut (#718).
 *
 * This enables CSS targeting such as:
 *   `.cm-line[data-tag-name="h1"] { ... }`
 */
export const containerAttributesField = createDecorationsField(
  buildContainerDecorations,
  (tr) => syntaxTree(tr.state) !== syntaxTree(tr.startState),
  true, // mapOnDocChanged
);

/** CM6 extension that adds `data-tag-name` attributes to `cm-line` elements. */
export const containerAttributesPlugin: Extension = containerAttributesField;
