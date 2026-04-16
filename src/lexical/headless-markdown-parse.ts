/**
 * Headless markdown parse — pooled side-editor that turns a markdown
 * fragment into the parsed top-level blocks as JSON, without paying the
 * full-tree rebuild cost on the live editor.
 *
 * Used by the paragraph-scope reveal adapter for its commit step (parse
 * the edited source, splice the resulting blocks back into the live
 * tree). The same primitive is the foundation for the deferred
 * incremental `applyChanges` work tracked by coflat2#218.
 *
 * Benchmarked at ~0.07 ms for a typical paragraph and ~5.5 ms for a
 * pathological 3.5 KB paragraph stuffed with inline tokens — three
 * orders of magnitude faster than the 620 ms full-document rebuild.
 */
import { $generateNodesFromSerializedNodes } from "@lexical/clipboard";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import {
  $getRoot,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
  type SerializedElementNode,
  type SerializedLexicalNode,
} from "lexical";

import { coflatMarkdownTransformers, createHeadlessCoflatEditor } from "./markdown";

/**
 * Faithful re-implementation of Lexical's internal `exportNodeToJSON`
 * (which isn't a public export). `node.exportJSON()` only returns the
 * node's own properties with an EMPTY `children` array — the framework
 * walks children separately when serializing the editor state.
 *
 * For ad hoc round-trips through the headless editor we need the same
 * recursive walk, so we keep it here as the canonical helper.
 */
export function $exportLexicalNodeToJSON(node: LexicalNode): SerializedLexicalNode {
  const serialized = node.exportJSON();
  if ($isElementNode(node)) {
    const elementSerialized = serialized as SerializedElementNode;
    elementSerialized.children = node.getChildren().map($exportLexicalNodeToJSON);
  }
  return serialized;
}

let pooledEditor: LexicalEditor | null = null;

function getPooledEditor(): LexicalEditor {
  pooledEditor ??= createHeadlessCoflatEditor();
  return pooledEditor;
}

/**
 * Parse a markdown fragment in the pooled side editor and return the
 * resulting top-level blocks as serialized JSON. Caller is responsible
 * for deserializing the JSON back into Lexical nodes inside its own
 * `editor.update(...)` and splicing them into the live tree.
 *
 * Returns an empty array for empty input. Round-trips through the same
 * `coflatMarkdownTransformers` the live editor uses on full-doc import.
 */
export function parseMarkdownFragmentToJSON(markdown: string): SerializedLexicalNode[] {
  const editor = getPooledEditor();
  let result: SerializedLexicalNode[] = [];
  editor.update(() => {
    // shouldPreserveNewLines=false: blank lines act as paragraph
    // separators (Pandoc semantics) instead of becoming empty
    // paragraphs of their own. The full-doc importer uses `true` so
    // round-trip line counts match exactly; for a fragment the user
    // typing `\n\n` means "split into two paragraphs", not "insert an
    // empty paragraph between two".
    $convertFromMarkdownString(markdown, coflatMarkdownTransformers, undefined, false);
    const root = $getRoot();
    result = root.getChildren().map($exportLexicalNodeToJSON);
  }, { discrete: true });
  return result;
}

/**
 * Serialize a single block (paragraph, heading, quote, list…) to its
 * markdown source via the pooled headless editor.
 *
 * Why not call `$convertToMarkdownString(transformers, block, …)` on the
 * live block directly? `$convertToMarkdownString` treats its `node` arg
 * as a *root-like* container and exports each child as a top-level
 * element. A `ParagraphNode`'s children are `TextNode`s, which aren't
 * top-level elements — the export drops them and returns an empty
 * string. Wrapping the block at the root of a side editor gives the
 * exporter a real top-level child to render.
 */
export function serializeBlockToMarkdown(blockJSON: SerializedLexicalNode): string {
  const editor = getPooledEditor();
  let result = "";
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const nodes = $generateNodesFromSerializedNodes([blockJSON]);
    for (const node of nodes) {
      root.append(node);
    }
    // shouldPreserveNewLines=false matches the parse side so the source
    // we hand the user round-trips through `parseMarkdownFragmentToJSON`
    // with no spurious blank-paragraph insertions.
    result = $convertToMarkdownString(coflatMarkdownTransformers, undefined, false);
  }, { discrete: true });
  return result;
}
