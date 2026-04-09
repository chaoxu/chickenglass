/**
 * Lightweight inline CM6 editor factory.
 *
 * Creates a minimal EditorView with inline-level rendering:
 * math (KaTeX), bold/italic/code marker hiding, highlight/strikethrough,
 * link styling, and citation/crossref rendering.
 * Used for table cell editing, sidenote editing, and other embedded contexts.
 */

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";

import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
  inlineMarkdownExtensions,
  sharedInlineRenderExtensions,
} from "./editor/base-editor-extensions";
import { CSS } from "./constants/css-classes";
import { referenceRenderPlugin } from "./render/reference-render";
import { documentAnalysisField } from "./semantics/codemirror-source";
import { type BibData, bibDataEffect, bibDataField } from "./state/bib-data";
import { frontmatterField } from "./state/frontmatter-state";

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
  /** Render as a read-only preview surface. */
  readOnly?: boolean;
}

export interface InlineEditorController {
  view: EditorView;
  setReadOnly: (readOnly: boolean) => void;
  setCallbacks: (
    callbacks: Pick<InlineEditorOptions, "onChange" | "onBlur" | "onKeydown">,
  ) => void;
  destroy: () => void;
}

/**
 * Create a lightweight CM6 EditorView with inline-level rendering.
 *
 * Includes math rendering (KaTeX), bold/italic/code marker hiding,
 * highlight and strikethrough support, link styling, and citation/crossref
 * rendering. No block-level elements (no headings, lists, code blocks,
 * fenced divs, etc.).
 */
export function createInlineEditorController(
  opts: InlineEditorOptions,
): InlineEditorController {
  const readOnly = opts.readOnly ?? false;
  const readOnlyCompartment = new Compartment();
  const editableCompartment = new Compartment();
  const callbacks = {
    onChange: opts.onChange,
    onBlur: opts.onBlur,
    onKeydown: opts.onKeydown,
  };
  const extensions: Extension[] = [
    ...createMarkdownLanguageExtensions({
      extensions: inlineMarkdownExtensions,
    }),
    ...createProjectConfigExtensions({ math: opts.macros }),
    ...sharedInlineRenderExtensions,
    frontmatterField,
    documentAnalysisField,
    bibDataField,
    referenceRenderPlugin,
    drawSelection(),
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    editableCompartment.of(EditorView.editable.of(!readOnly)),
    EditorView.editorAttributes.of({ class: CSS.inlineEditor }),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        callbacks.onChange(update.state.doc.toString());
      }
    }),
    EditorView.domEventHandlers({
      blur: () => {
        callbacks.onBlur?.();
      },
      keydown: (event) => callbacks.onKeydown?.(event) ?? false,
    }),
  ];

  const view = new EditorView({
    state: EditorState.create({
      doc: opts.doc,
      extensions,
    }),
    parent: opts.parent,
  });

  if (opts.bibData) {
    view.dispatch({ effects: bibDataEffect.of(opts.bibData) });
  }

  return {
    view,
    setReadOnly(nextReadOnly) {
      view.dispatch({
        effects: [
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(nextReadOnly)),
          editableCompartment.reconfigure(EditorView.editable.of(!nextReadOnly)),
        ],
      });
    },
    setCallbacks(nextCallbacks) {
      callbacks.onChange = nextCallbacks.onChange;
      callbacks.onBlur = nextCallbacks.onBlur;
      callbacks.onKeydown = nextCallbacks.onKeydown;
    },
    destroy() {
      view.destroy();
    },
  };
}

export function createInlineEditor(opts: InlineEditorOptions): EditorView {
  return createInlineEditorController(opts).view;
}
