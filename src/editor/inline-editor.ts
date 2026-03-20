/**
 * Lightweight inline CM6 editor factory.
 *
 * Creates a minimal EditorView with only inline-level rendering:
 * math (KaTeX), bold/italic/code marker hiding, and highlight/strikethrough.
 * Used for table cell editing, sidenote editing, and other embedded contexts.
 */

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import { mathExtension } from "../parser/math-backslash";
import { highlightExtension } from "../parser/highlight";
import { strikethroughExtension } from "../parser/strikethrough";
import { mathRenderPlugin } from "../render/math-render";
import { markdownRenderPlugin } from "../render/markdown-render";
import { projectConfigFacet } from "../app/project-config";
import { frontmatterField } from "./frontmatter-state";

/** Options for creating a lightweight inline editor. */
export interface InlineEditorOptions {
  /** Parent element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc: string;
  /** KaTeX math macros to make available. */
  macros: Record<string, string>;
  /** Called whenever the document changes. */
  onChange: (newDoc: string) => void;
  /** Called when the editor loses focus. */
  onBlur?: () => void;
  /** Called on keydown; return true to prevent default handling. */
  onKeydown?: (event: KeyboardEvent) => boolean;
}

/** Theme for inline editors: transparent, no chrome, inherits parent font.
 *  Uses !important to override the outer (parent) editor's scoped theme
 *  rules, which cascade into nested CM6 instances sharing the same
 *  generated scope classes (e.g. ͼ1, ͼ2). Without !important, the outer
 *  editor's .cm-content { padding: 24px 48px; max-width: 720px } wins. */
const inlineEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent !important",
    fontFamily: "inherit !important",
    fontSize: "inherit !important",
    padding: "0 !important",
    margin: "0 !important",
    border: "none !important",
    minHeight: "auto !important",
  },
  "&.cm-focused": {
    outline: "none !important",
  },
  ".cm-gutters": {
    display: "none !important",
  },
  ".cm-scroller": {
    overflow: "visible !important",
  },
  ".cm-content": {
    padding: "0 !important",
    margin: "0 !important",
    minHeight: "auto !important",
    maxWidth: "none !important",
  },
  ".cm-line": {
    padding: "0 !important",
  },
  ".cm-cursor": {
    borderLeftColor: "currentColor",
  },
});

/**
 * Create a lightweight CM6 EditorView with only inline-level rendering.
 *
 * Includes math rendering (KaTeX), bold/italic/code marker hiding,
 * highlight and strikethrough support, but no block-level elements
 * (no headings, lists, code blocks, fenced divs, etc.).
 */
export function createInlineEditor(opts: InlineEditorOptions): EditorView {
  const extensions: Extension[] = [
    // Parser: markdown with only inline-relevant extensions
    markdown({
      extensions: [mathExtension, highlightExtension, strikethroughExtension],
    }),

    // Math macros: provide via project config facet so frontmatterField picks them up
    projectConfigFacet.of({ math: opts.macros }),

    // Math rendering (includes editorFocusField, focusTracker, mathMacrosField)
    mathRenderPlugin,

    // Frontmatter state field (reads macros from projectConfigFacet)
    frontmatterField,

    // Inline mark hiding (bold/italic/code/strikethrough markers)
    markdownRenderPlugin,

    // Theme: transparent, no gutters, inherit font
    inlineEditorTheme,
    EditorView.lineWrapping,

    // Callbacks
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        opts.onChange(update.state.doc.toString());
      }
    }),

    EditorView.domEventHandlers({
      blur: () => {
        opts.onBlur?.();
      },
      keydown: (event) => opts.onKeydown?.(event) ?? false,
    }),
  ];

  return new EditorView({
    state: EditorState.create({
      doc: opts.doc,
      extensions,
    }),
    parent: opts.parent,
  });
}
