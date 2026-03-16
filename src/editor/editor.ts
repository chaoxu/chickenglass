import { markdown } from "@codemirror/lang-markdown";
import { type Extension, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { editorKeybindings } from "./keybindings";
import { chickenglassTheme } from "./theme";

const sampleDocument = `# Chickenglass

A semantic document editor for mathematical writing.

## Getting started

This is a **CodeMirror 6** editor with *markdown* syntax highlighting.

- Fenced divs for semantic blocks
- KaTeX for math rendering
- Cross-references and citations

\`\`\`typescript
const greeting = "Hello, world!";
\`\`\`
`;

export interface EditorConfig {
  /** The DOM element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc?: string;
  /** Additional CM6 extensions to include. */
  extensions?: Extension[];
}

/** Create and mount a CodeMirror 6 markdown editor. */
export function createEditor(config: EditorConfig): EditorView {
  const state = EditorState.create({
    doc: config.doc ?? sampleDocument,
    extensions: [
      markdown(),
      editorKeybindings,
      chickenglassTheme,
      ...(config.extensions ?? []),
    ],
  });

  return new EditorView({
    state,
    parent: config.parent,
  });
}
