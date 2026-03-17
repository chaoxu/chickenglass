import { markdown } from "@codemirror/lang-markdown";
import { type Extension, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Table, TaskList } from "@lezer/markdown";
import {
  removeIndentedCode,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  strikethroughExtension,
  highlightExtension,
} from "../parser";
import { frontmatterField, frontmatterDecoration } from "./frontmatter-state";
import {
  markdownRenderPlugin,
  mathRenderPlugin,
  crossrefRenderPlugin,
  containerAttributesPlugin,
  imageRenderPlugin,
  codeBlockRenderPlugin,
  tableRenderPlugin,
  debugInspectorPlugin,
  checkboxRenderPlugin,
  mathPreviewPlugin,
} from "../render";
import {
  createPluginRegistryField,
  blockCounterField,
  blockRenderPlugin,
  defaultPlugins,
} from "../plugins";
import { citationRenderPlugin, bibliographyPlugin } from "../citations";
import { editorKeybindings } from "./keybindings";
import { chickenglassTheme } from "./theme";

const sampleDocument = `---
title: Chickenglass Demo
math:
  \\R: "\\\\mathbb{R}"
  \\N: "\\\\mathbb{N}"
---

# Chickenglass

A semantic document editor for mathematical writing.

## Inline Math

The Euler identity $e^{i\\pi} + 1 = 0$ is elegant. We also have $\\R$ and $\\N$.

## Display Math

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$ {#eq:sum}

## Theorem Environment

::: {.theorem #thm-main} Fundamental Theorem
Every continuous function $f: [a,b] \\to \\R$ is bounded.
:::

::: {.proof}
Follows from compactness of $[a,b]$.
:::

::: {.lemma #lem-aux}
A useful lemma for the proof.
:::

::: {.definition #def-compact}
A set $K$ is **compact** if every open cover has a finite subcover.
:::

## Cross-References

See [@thm-main] and [@eq:sum] for details.

## Table

| Concept       | Symbol    | Description              |
| :------------ | :-------: | -----------------------: |
| Natural nums  | $\\N$     | **Counting** numbers     |
| Real nums     | $\\R$     | *Continuous* number line |
| Euler's       | $e^{i\\pi}$ | Most beautiful identity |

## Code Block

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
      // Parser: markdown with custom extensions
      markdown({
        extensions: [
          removeIndentedCode,
          mathExtension,
          fencedDiv,
          equationLabelExtension,
          strikethroughExtension,
          highlightExtension,
          Table,
          TaskList,
        ],
      }),

      // Frontmatter state (must come before plugins that depend on it)
      frontmatterField,
      frontmatterDecoration,

      // Block plugin system
      createPluginRegistryField(defaultPlugins),
      blockCounterField,

      // Rendering plugins
      markdownRenderPlugin,
      mathRenderPlugin,
      imageRenderPlugin,
      blockRenderPlugin,
      crossrefRenderPlugin,
      codeBlockRenderPlugin,
      citationRenderPlugin,
      bibliographyPlugin,
      containerAttributesPlugin,
      tableRenderPlugin,
      debugInspectorPlugin,
      checkboxRenderPlugin,
      mathPreviewPlugin,

      // Editor chrome
      editorKeybindings,
      chickenglassTheme,

      // User-provided extensions last
      ...(config.extensions ?? []),
    ],
  });

  return new EditorView({
    state,
    parent: config.parent,
  });
}
