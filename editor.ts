import { createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";

import { type EditorMode, normalizeEditorMode } from "./src/app/editor-mode";
import {
  LexicalPlainTextEditor,
  type MarkdownEditorHandle,
} from "./src/lexical/plain-text-editor";

export type StandaloneEditorMode = EditorMode;

export interface MountEditorOptions {
  readonly parent: HTMLElement;
  readonly doc?: string;
  readonly mode?: StandaloneEditorMode;
  readonly onChange?: (doc: string) => void;
  readonly onModeChange?: (mode: StandaloneEditorMode) => void;
}

export interface MountedEditor {
  readonly getDoc: () => string;
  readonly setDoc: (doc: string) => void;
  readonly getMode: () => StandaloneEditorMode;
  readonly setMode: (mode: StandaloneEditorMode) => void;
  readonly focus: () => void;
  readonly unmount: () => void;
}

interface StandaloneEditorControl {
  readonly focus: () => void;
  readonly getDoc: () => string;
  readonly getMode: () => StandaloneEditorMode;
  readonly setDoc: (doc: string) => void;
  readonly setMode: (mode: StandaloneEditorMode) => void;
}

interface MountedLexicalEditorProps {
  readonly controlRef: { current: StandaloneEditorControl | null };
  readonly initialDoc: string;
  readonly initialMode: StandaloneEditorMode;
  readonly onChange?: (doc: string) => void;
  readonly onModeChange?: (mode: StandaloneEditorMode) => void;
}

function MountedLexicalEditor({
  controlRef,
  initialDoc,
  initialMode,
  onChange,
  onModeChange,
}: MountedLexicalEditorProps) {
  const [doc, setDoc] = useState(initialDoc);
  const [mode, setModeState] = useState<StandaloneEditorMode>(initialMode);
  const docRef = useRef(initialDoc);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);

  useEffect(() => {
    controlRef.current = {
      focus: () => handleRef.current?.focus(),
      getDoc: () => docRef.current,
      getMode: () => mode,
      setDoc: (nextDoc) => {
        docRef.current = nextDoc;
        setDoc(nextDoc);
      },
      setMode: (nextMode) => {
        const normalized = normalizeEditorMode(nextMode, true);
        setModeState(normalized);
        onModeChange?.(normalized);
      },
    };

    return () => {
      controlRef.current = null;
    };
  }, [controlRef, mode, onModeChange]);

  return (
    createElement(LexicalPlainTextEditor, {
      doc,
      namespace: "coflat-standalone-editor",
      editorClassName: [
        "cf-lexical-editor",
        "h-full overflow-auto px-6 py-8 text-[var(--cf-fg)] outline-none",
        mode === "source"
          ? "cf-lexical-editor--source font-mono whitespace-pre-wrap"
          : "whitespace-pre-wrap",
      ].join(" "),
      onEditorReady: (handle: MarkdownEditorHandle) => {
        handleRef.current = handle;
      },
      onTextChange: (nextDoc: string) => {
        docRef.current = nextDoc;
      },
      onDocChange: () => {
        onChange?.(docRef.current);
      },
    })
  );
}

export function mountEditor(options: MountEditorOptions): MountedEditor {
  const initialDoc = options.doc ?? "";
  const initialMode = normalizeEditorMode(options.mode ?? "lexical", true);
  const controlRef: { current: StandaloneEditorControl | null } = { current: null };

  options.parent.replaceChildren();
  const root: Root = createRoot(options.parent);
  flushSync(() => {
    root.render(createElement(MountedLexicalEditor, {
      controlRef,
      initialDoc,
      initialMode,
      onChange: options.onChange,
      onModeChange: options.onModeChange,
    }));
  });

  return {
    getDoc() {
      return controlRef.current?.getDoc() ?? initialDoc;
    },
    setDoc(doc) {
      flushSync(() => {
        controlRef.current?.setDoc(doc);
      });
    },
    getMode() {
      return controlRef.current?.getMode() ?? initialMode;
    },
    setMode(mode) {
      flushSync(() => {
        controlRef.current?.setMode(mode);
      });
    },
    focus() {
      controlRef.current?.focus();
    },
    unmount() {
      root.unmount();
      options.parent.replaceChildren();
    },
  };
}
