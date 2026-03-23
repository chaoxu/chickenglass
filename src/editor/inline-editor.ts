/**
 * Lightweight inline CM6 editor factory.
 *
 * Creates a minimal EditorView with inline-level rendering:
 * math (KaTeX), bold/italic/code marker hiding, highlight/strikethrough,
 * link styling, and citation/crossref rendering.
 * Used for table cell editing, sidenote editing, and other embedded contexts.
 */

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
  inlineMarkdownExtensions,
  sharedDocumentStateExtensions,
  sharedInlineRenderExtensions,
} from "./base-editor-extensions";
import { type BibData, bibDataEffect, bibDataField } from "../citations/citation-render";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { referenceRenderPlugin } from "../render/reference-render";

/** Options for creating a lightweight inline editor. */
export interface InlineEditorOptions {
  /** Parent element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc: string;
  /** KaTeX math macros to make available. */
  macros: Record<string, string>;
  /** Bibliography data for citation rendering. When provided, the inline
   *  editor renders [@id] citations and @id cross-references. */
  bibData?: BibData;
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
 *  editor's .cm-content { padding: 24px 48px; max-width: 800px } wins. */
const inlineEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent !important",
    fontFamily: "inherit !important",
    fontSize: "inherit !important",
    lineHeight: "inherit !important",
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
    lineHeight: "inherit !important",
    fontFamily: "inherit !important",
    fontSize: "inherit !important",
  },
  ".cm-content": {
    padding: "0 !important",
    margin: "0 !important",
    minHeight: "auto !important",
    maxWidth: "none !important",
    fontFamily: "inherit !important",
    fontSize: "inherit !important",
    lineHeight: "inherit !important",
  },
  ".cm-line": {
    padding: "0 !important",
  },
  ".cm-cursor": {
    borderLeftColor: "currentColor",
  },
});

/**
 * Create a lightweight CM6 EditorView with inline-level rendering.
 *
 * Includes math rendering (KaTeX), bold/italic/code marker hiding,
 * highlight and strikethrough support, link styling, and citation/crossref
 * rendering. No block-level elements (no headings, lists, code blocks,
 * fenced divs, etc.).
 */
export function createInlineEditor(opts: InlineEditorOptions): EditorView {
  const extensions: Extension[] = [
    // Parser: markdown with only inline-relevant extensions
    ...createMarkdownLanguageExtensions({
      extensions: inlineMarkdownExtensions,
    }),

    // Math macros: provide via project config facet so frontmatterField picks them up
    ...createProjectConfigExtensions({ math: opts.macros }),

    // Math rendering (includes editorFocusField, focusTracker, mathMacrosField)
    ...sharedInlineRenderExtensions,

    // Frontmatter state field (reads macros from projectConfigFacet)
    ...sharedDocumentStateExtensions,

    // Document semantics (reference discovery for citation/crossref rendering)
    documentAnalysisField,

    // Bibliography state (initialized empty; populated below via bibDataEffect)
    bibDataField,

    // Citation/crossref rendering (needs documentAnalysisField + bibDataField)
    referenceRenderPlugin,

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

  const view = new EditorView({
    state: EditorState.create({
      doc: opts.doc,
      extensions,
    }),
    parent: opts.parent,
  });

  // Populate bibliography data from the parent editor so citations render
  if (opts.bibData) {
    view.dispatch({ effects: bibDataEffect.of(opts.bibData) });
  }

  return view;
}
