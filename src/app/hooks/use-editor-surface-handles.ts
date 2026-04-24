import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";

import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import type { DiagnosticEntry } from "../diagnostics";
import type { FileSystem } from "../file-manager";
import type { HeadingEntry } from "../heading-ancestry";
import type { UseEditorReturn } from "./use-editor";

export interface PendingLexicalNavigation {
  readonly onComplete?: () => void;
  readonly path: string;
  readonly pos: number;
  readonly requestId: number;
}

export interface EditorSurfaceHandlesDeps {
  currentPath: string | null;
  editorDoc: string;
  editorHandleRef: MutableRefObject<MarkdownEditorHandle | null>;
  fs?: FileSystem;
  handleCmGotoLine: (line: number, col?: number) => void;
  handleCmOutlineSelect: (from: number) => void;
  syncView: (view: EditorView | null) => void;
}

export interface EditorSurfaceHandlesController {
  diagnostics: DiagnosticEntry[];
  editorState: UseEditorReturn | null;
  getLexicalEditorHandle: () => MarkdownEditorHandle | null;
  handleDiagnosticsChange: (diagnostics: DiagnosticEntry[]) => void;
  handleEditorStateChange: (state: UseEditorReturn) => void;
  handleGotoLine: (line: number, col?: number) => void;
  handleHeadingsChange: (headings: HeadingEntry[]) => void;
  handleInsertImage: () => void;
  handleLexicalEditorReady: (handle: MarkdownEditorHandle | null) => void;
  handleLexicalSurfaceReady: () => void;
  handleOutlineSelect: (from: number) => void;
  handleWatchedPathChange: (path: string) => void;
  headings: HeadingEntry[];
  queueLexicalNavigation: (navigation: PendingLexicalNavigation) => void;
  clearPendingLexicalNavigation: (requestId?: number) => void;
}

type SaveImage = (file: File) => Promise<string>;

interface LexicalImageSaverOptions {
  readonly docPath: string | null;
  readonly fs?: FileSystem;
  readonly getDoc: () => string;
}

function selectedLineIsEmpty(doc: string, from: number): boolean {
  const lineStart = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const nextLineBreak = doc.indexOf("\n", from);
  const lineEnd = nextLineBreak === -1 ? doc.length : nextLineBreak;
  return doc.slice(lineStart, lineEnd).trim() === "" && from === lineStart;
}

async function insertImageIntoLexicalHandle(
  lexicalHandle: MarkdownEditorHandle,
  saveImage?: SaveImage,
): Promise<void> {
  const {
    IMAGE_EXTENSIONS,
    IMAGE_MIME_EXT,
    altTextFromFilename,
    escapeMarkdownPath,
    fileToDataUrl,
    generateImageFilename,
    isImageMime,
    logImageError,
  } = await import("../../editor/image-save");
  const { IMAGE_TIMEOUT_MS } = await import("../../constants");

  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",") + ",image/*";
    input.style.display = "none";
    let done = false;
    let timeoutId: number | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      input.remove();
      resolve();
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish();
        return;
      }

      if (!isImageMime(file.type)) {
        logImageError("insert", `unsupported MIME type: ${file.type}`);
        finish();
        return;
      }

      const save = saveImage ?? fileToDataUrl;
      void save(file).then((path) => {
        const filename = generateImageFilename(file, IMAGE_MIME_EXT[file.type] ?? "png");
        const alt = altTextFromFilename(filename);
        const doc = lexicalHandle.peekDoc();
        const selection = lexicalHandle.peekSelection();
        const prefix = selectedLineIsEmpty(doc, selection.from) ? "" : "\n";
        lexicalHandle.insertText(`${prefix}![${alt}](${escapeMarkdownPath(path)})\n`);
        lexicalHandle.focus();
      }).catch((error: unknown) => {
        logImageError("insert", error);
      }).finally(finish);
    });

    input.addEventListener("cancel", () => {
      finish();
    });

    document.body.appendChild(input);
    timeoutId = window.setTimeout(() => {
      finish();
    }, IMAGE_TIMEOUT_MS);
    input.click();
  });
}

async function createLexicalImageSaver({
  docPath,
  fs,
  getDoc,
}: LexicalImageSaverOptions): Promise<SaveImage | undefined> {
  if (!docPath) {
    return undefined;
  }

  const [{ createImageSaver }, { parseFrontmatter }] = await Promise.all([
    import("../../editor/image-save"),
    import("../../parser/frontmatter"),
  ]);

  return createImageSaver({
    fs,
    docPath,
    get imageFolder() {
      return parseFrontmatter(getDoc()).config.imageFolder;
    },
  });
}

export function useEditorSurfaceHandles({
  currentPath,
  editorDoc,
  editorHandleRef,
  fs,
  handleCmGotoLine,
  handleCmOutlineSelect,
  syncView,
}: EditorSurfaceHandlesDeps): EditorSurfaceHandlesController {
  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const editorViewRef = useRef<EditorView | null>(null);
  const pendingLexicalNavigationRef = useRef<PendingLexicalNavigation | null>(null);

  const completeLexicalNavigation = useCallback(() => {
    const pending = pendingLexicalNavigationRef.current;
    const lexicalHandle = editorHandleRef.current;
    if (!pending || !lexicalHandle || pending.path !== currentPath) {
      return;
    }
    pendingLexicalNavigationRef.current = null;
    lexicalHandle.setSelection(pending.pos, pending.pos);
    lexicalHandle.focus();
    pending.onComplete?.();
  }, [currentPath, editorHandleRef]);

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);
    editorViewRef.current = state.view;
    syncView(state.view);
  }, [syncView]);

  const handleLexicalSurfaceReady = useCallback(() => {
    setEditorState(null);
    editorViewRef.current = null;
    syncView(null);
    setHeadings([]);
    setDiagnostics([]);
  }, [syncView]);

  const handleLexicalEditorReady = useCallback((handle: MarkdownEditorHandle | null) => {
    editorHandleRef.current = handle;
    if (handle) {
      completeLexicalNavigation();
    }
  }, [completeLexicalNavigation, editorHandleRef]);

  const getLexicalEditorHandle = useCallback(() => editorHandleRef.current, [editorHandleRef]);

  const handleHeadingsChange = useCallback((nextHeadings: HeadingEntry[]) => {
    setHeadings(nextHeadings);
  }, []);

  const handleDiagnosticsChange = useCallback((nextDiagnostics: DiagnosticEntry[]) => {
    setDiagnostics(nextDiagnostics);
  }, []);

  const handleWatchedPathChange = useCallback((path: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    void import("../../render/image-url-cache").then(({ invalidateImageDataUrl }) => {
      if (editorViewRef.current !== view) return;
      invalidateImageDataUrl(view, path);
    });
  }, []);

  const handleInsertImage = useCallback(() => {
    const view = editorState?.view;
    if (view) {
      void import("../../editor").then(({ insertImageFromPicker }) => {
        if (editorViewRef.current !== view) return;
        void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
      });
      return;
    }

    const lexicalHandle = editorHandleRef.current;
    if (lexicalHandle) {
      void createLexicalImageSaver({
        docPath: currentPath,
        fs,
        getDoc: () => lexicalHandle.peekDoc(),
      }).then((saveImage) => insertImageIntoLexicalHandle(lexicalHandle, saveImage));
      return;
    }

    console.warn("[editor] Insert Image is unavailable until an editor surface is ready.");
  }, [currentPath, editorHandleRef, editorState?.view, editorState?.imageSaver, fs]);

  const handleOutlineSelect = useCallback((from: number) => {
    const lexicalHandle = editorHandleRef.current;
    if (lexicalHandle) {
      lexicalHandle.setSelection(from, from);
      lexicalHandle.focus();
      return;
    }
    handleCmOutlineSelect(from);
  }, [editorHandleRef, handleCmOutlineSelect]);

  const handleGotoLine = useCallback((line: number, col?: number) => {
    const lexicalHandle = editorHandleRef.current;
    if (lexicalHandle) {
      const doc = lexicalHandle.peekDoc();
      const lines = doc.split(/\r\n|\n|\r/);
      const clampedLine = Math.max(1, Math.min(line, lines.length));
      const lineStart = lines
        .slice(0, clampedLine - 1)
        .reduce((offset, currentLine) => offset + currentLine.length + 1, 0);
      const lineText = lines[clampedLine - 1] ?? "";
      const offset = lineStart + Math.max(0, Math.min((col ?? 1) - 1, lineText.length));
      lexicalHandle.setSelection(offset, offset);
      lexicalHandle.focus();
      return;
    }
    handleCmGotoLine(line, col);
  }, [editorHandleRef, handleCmGotoLine]);

  const queueLexicalNavigation = useCallback((navigation: PendingLexicalNavigation) => {
    pendingLexicalNavigationRef.current = navigation;
    completeLexicalNavigation();
  }, [completeLexicalNavigation]);

  const clearPendingLexicalNavigation = useCallback((requestId?: number) => {
    if (
      requestId !== undefined
      && pendingLexicalNavigationRef.current?.requestId !== requestId
    ) {
      return;
    }
    pendingLexicalNavigationRef.current = null;
  }, []);

  useEffect(() => {
    completeLexicalNavigation();
  }, [completeLexicalNavigation, editorDoc]);

  return {
    diagnostics,
    editorState,
    getLexicalEditorHandle,
    handleDiagnosticsChange,
    handleEditorStateChange,
    handleGotoLine,
    handleHeadingsChange,
    handleInsertImage,
    handleLexicalEditorReady,
    handleLexicalSurfaceReady,
    handleOutlineSelect,
    handleWatchedPathChange,
    headings,
    queueLexicalNavigation,
    clearPendingLexicalNavigation,
  };
}
