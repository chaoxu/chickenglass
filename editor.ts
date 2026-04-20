import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  createEditor,
  editorModeField,
  setEditorMode,
} from "./src/editor";
import { programmaticDocumentChangeAnnotation } from "./src/editor/programmatic-document-change";

export type StandaloneEditorMode = "rich" | "source";

export interface MountEditorOptions {
  /** DOM element that receives the mounted editor. */
  parent: HTMLElement;
  /** Initial markdown content. Defaults to an empty document. */
  doc?: string;
  /** Initial display mode. Standalone support is limited to rich/source. */
  mode?: StandaloneEditorMode;
  /** Extra CodeMirror extensions supplied by the host. */
  extensions?: readonly Extension[];
  /** Called for direct user edits only. */
  onChange?: (doc: string) => void;
  /** Called whenever the effective rich/source mode changes. */
  onModeChange?: (mode: StandaloneEditorMode) => void;
}

export interface MountedEditor {
  getDoc: () => string;
  setDoc: (doc: string) => void;
  getMode: () => StandaloneEditorMode;
  setMode: (mode: StandaloneEditorMode) => void;
  focus: () => void;
  unmount: () => void;
}

function toStandaloneMode(mode: string | undefined): StandaloneEditorMode {
  return mode === "source" ? "source" : "rich";
}

export function mountEditor(options: MountEditorOptions): MountedEditor {
  const initialDoc = options.doc ?? "";
  const initialMode = options.mode ?? "rich";
  let currentDoc = initialDoc;
  let currentMode: StandaloneEditorMode = "rich";
  let suppressModeCallback = false;

  options.parent.replaceChildren();

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const nextDoc = update.state.doc.toString();
      currentDoc = nextDoc;
      const programmaticDocChange = update.transactions.some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation),
      );
      if (!programmaticDocChange) {
        options.onChange?.(nextDoc);
      }
    }

    const nextMode = toStandaloneMode(update.state.field(editorModeField, false));
    if (nextMode !== currentMode) {
      currentMode = nextMode;
      if (!suppressModeCallback) {
        options.onModeChange?.(nextMode);
      }
    }
  });

  let view: EditorView | null = createEditor({
    parent: options.parent,
    doc: initialDoc,
    extensions: [updateListener, ...(options.extensions ?? [])],
  });

  if (initialMode !== "rich") {
    suppressModeCallback = true;
    setEditorMode(view, initialMode);
    suppressModeCallback = false;
  }

  currentMode = toStandaloneMode(view.state.field(editorModeField, false));

  return {
    getDoc() {
      return currentDoc;
    },

    setDoc(doc) {
      currentDoc = doc;
      if (!view || doc === view.state.doc.toString()) {
        return;
      }

      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: doc,
        },
        selection: { anchor: 0 },
        annotations: programmaticDocumentChangeAnnotation.of(true),
      });
      view.scrollDOM.scrollTop = 0;
    },

    getMode() {
      return currentMode;
    },

    setMode(mode) {
      if (!view) {
        currentMode = mode;
        return;
      }
      setEditorMode(view, mode);
    },

    focus() {
      view?.focus();
    },

    unmount() {
      if (!view) {
        return;
      }
      const mountedView = view;
      view = null;
      mountedView.destroy();
      options.parent.replaceChildren();
    },
  };
}
