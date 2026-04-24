import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import type { InitialEditorStateType } from "@lexical/react/LexicalComposer";
import type {
  EditorUpdateOptions,
  LexicalEditor,
  SerializedEditorState,
} from "lexical";

import { findNextInlineMathSource } from "../lib/inline-math-source";
import { measureSync } from "../lib/perf";
import { createHeadlessMarkdownService } from "./headless-markdown-service";
import { createHeadlessCoflatEditor } from "./markdown-schema";
import { coflatMarkdownTransformers } from "./markdown-transformers";
import { publishLexicalSourceBlockIdentitiesForCurrentRoot } from "./source-block-identity";

export function createLexicalInitialEditorState(markdown: string): InitialEditorStateType {
  return () => {
    $convertFromMarkdownString(markdown, coflatMarkdownTransformers, undefined, true);
  };
}

export function setLexicalMarkdown(
  editor: LexicalEditor,
  markdown: string,
  options?: {
    readonly discrete?: boolean;
    readonly tag?: EditorUpdateOptions["tag"];
  },
): void {
  measureSync("lexical.setLexicalMarkdown", () => {
    const updateOptions: EditorUpdateOptions = {
      tag: options?.tag,
    };
    if (options?.discrete ?? true) {
      updateOptions.discrete = true;
    }
    editor.update(() => {
      $convertFromMarkdownString(markdown, coflatMarkdownTransformers, undefined, true);
      publishLexicalSourceBlockIdentitiesForCurrentRoot(editor, markdown);
    }, updateOptions);
  }, { category: "lexical", detail: `${markdown.length} chars` });
}

const FORMATTED_INLINE_SOURCE_NODE_TYPES = new Set([
  "coflat-footnote-reference",
  "coflat-inline-image",
  "coflat-inline-math",
  "coflat-reference",
]);

interface SerializedNodeRecord {
  readonly children?: unknown;
  readonly format?: unknown;
  readonly raw?: unknown;
  readonly text?: unknown;
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

function isSerializedNodeRecord(value: unknown): value is SerializedNodeRecord {
  return typeof value === "object" && value !== null;
}

function sourceReplacementPlaceholder(index: number): string {
  return `\uE000coflat-source-${index}\uE001`;
}

function replaceLiteralDollarMathText(
  text: string,
  replacements: string[],
): {
  readonly changed: boolean;
  readonly text: string;
} {
  let cursor = 0;
  let next = "";
  let changed = false;

  for (;;) {
    const parsed = findNextInlineMathSource(text, cursor);
    if (!parsed) break;

    next += text.slice(cursor, parsed.from);
    const placeholder = sourceReplacementPlaceholder(replacements.length);
    replacements.push(`\\${parsed.raw}`);
    next += placeholder;
    cursor = parsed.to;
    changed = true;
  }

  return changed
    ? { changed, text: next + text.slice(cursor) }
    : { changed, text };
}

function transformFormattedInlineSourceNodes(
  node: unknown,
  replacements: string[] = [],
): {
  readonly changed: boolean;
  readonly node: unknown;
} {
  if (!isSerializedNodeRecord(node)) {
    return { changed: false, node };
  }

  if (node.type === "text" && typeof node.text === "string") {
    const escaped = replaceLiteralDollarMathText(node.text, replacements);
    return escaped.changed
      ? {
          changed: true,
          node: {
            ...node,
            text: escaped.text,
          },
        }
      : { changed: false, node };
  }

  if (
    typeof node.type === "string"
    && FORMATTED_INLINE_SOURCE_NODE_TYPES.has(node.type)
    && typeof node.raw === "string"
    && typeof node.format === "number"
    && node.format !== 0
  ) {
    const placeholder = sourceReplacementPlaceholder(replacements.length);
    replacements.push(node.raw);
    return {
      changed: true,
      node: {
        detail: 0,
        format: node.format,
        mode: "normal",
        style: "",
        text: placeholder,
        type: "text",
        version: 1,
      },
    };
  }

  if (!Array.isArray(node.children)) {
    return { changed: false, node };
  }

  let changed = false;
  const children = node.children.map((child) => {
    const result = transformFormattedInlineSourceNodes(child, replacements);
    changed ||= result.changed;
    return result.node;
  });

  if (!changed) {
    return { changed: false, node };
  }

  return {
    changed: true,
    node: {
      ...node,
      children,
    },
  };
}

export function exportMarkdownFromSerializedState(
  state: SerializedEditorState,
  sourceReplacements: readonly string[] = [],
): string {
  const markdown = withPooledHeadlessMarkdownEditor((exportEditor) => {
    exportEditor.setEditorState(exportEditor.parseEditorState(JSON.stringify(state)));
    return exportEditor.getEditorState().read(() =>
      $convertToMarkdownString(coflatMarkdownTransformers, undefined, true)
    );
  });
  return sourceReplacements.reduce(
    (current, source, index) =>
      current.replaceAll(sourceReplacementPlaceholder(index), source),
    markdown,
  );
}

export function getLexicalMarkdown(editor: LexicalEditor): string {
  return measureSync("lexical.getLexicalMarkdown", () => {
    const editorState = editor.getEditorState();
    const serialized = editorState.toJSON();
    const sourceReplacements: string[] = [];
    const transformedRoot = transformFormattedInlineSourceNodes(
      serialized.root,
      sourceReplacements,
    );
    if (transformedRoot.changed) {
      return exportMarkdownFromSerializedState({
        root: transformedRoot.node as SerializedEditorState["root"],
      }, sourceReplacements);
    }
    return editorState.read(() =>
      $convertToMarkdownString(coflatMarkdownTransformers, undefined, true)
    );
  }, { category: "lexical" });
}

export const headlessMarkdownService = createHeadlessMarkdownService(
  createHeadlessCoflatEditor,
);

export function withPooledHeadlessMarkdownEditor<T>(
  task: (editor: LexicalEditor) => T,
): T {
  return headlessMarkdownService.withPooledEditor(task);
}

export function roundTripMarkdown(markdown: string): string {
  return withPooledHeadlessMarkdownEditor((editor) => {
    setLexicalMarkdown(editor, markdown);
    return getLexicalMarkdown(editor);
  });
}
