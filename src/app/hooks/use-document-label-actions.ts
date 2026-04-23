import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentLabelBacklinksResult } from "../../semantics/document-label-backlinks";
import type { DocumentLabelRenameTarget } from "../../semantics/document-label-rename";
import { dispatchIfConnected } from "../lib/view-dispatch";
import type { AppEditorShellController } from "./use-app-editor-shell";

const LABEL_ACTION_MESSAGE =
  "Place the cursor on a local label definition or reference in the current document.";

type EditorViewSnapshot = NonNullable<AppEditorShellController["editorState"]>["view"];

interface DocumentLabelActionsDeps {
  readonly editor: Pick<
    AppEditorShellController,
    "activeDocumentSignal" | "currentPath" | "editorState"
  >;
}

export interface DocumentLabelActionsController {
  readonly labelBacklinks: DocumentLabelBacklinksResult | null;
  readonly closeLabelBacklinks: () => void;
  readonly showLabelBacklinks: () => void;
  readonly renameDocumentLabel: () => void;
}

function duplicateRenameMessage(id: string): string {
  return `Local label "${id}" is defined more than once in this document. Resolve the duplicate label before renaming it.`;
}

function renamePromptMessage(target: DocumentLabelRenameTarget): string {
  const referenceCount = target.references.length;
  const referenceWord = referenceCount === 1 ? "reference" : "references";
  return [
    `Rename local label "${target.definition.id}" to:`,
    `This will update 1 definition and ${referenceCount} ${referenceWord} in the current document.`,
  ].join("\n\n");
}

function renameValidationMessage(nextId: string): string {
  return [
    `Cannot rename label to "${nextId.trim()}".`,
    "Use a non-empty id with no spaces. Allowed characters: letters, numbers, _, ., :, and -.",
  ].join("\n\n");
}

export function useDocumentLabelActions({
  editor,
}: DocumentLabelActionsDeps): DocumentLabelActionsController {
  const [labelBacklinks, setLabelBacklinks] = useState<DocumentLabelBacklinksResult | null>(null);
  const latestEditorViewRef = useRef({
    currentPath: editor.currentPath,
    view: editor.editorState?.view ?? null,
  });
  latestEditorViewRef.current = {
    currentPath: editor.currentPath,
    view: editor.editorState?.view ?? null,
  };

  const isCurrentEditorView = useCallback((
    path: string | null,
    view: EditorViewSnapshot,
  ) => {
    const latest = latestEditorViewRef.current;
    return latest.currentPath === path && latest.view === view;
  }, []);

  useEffect(() => {
    setLabelBacklinks(null);
  }, [editor.currentPath]);

  useEffect(() => {
    if (labelBacklinks === null) {
      return;
    }

    return editor.activeDocumentSignal.subscribe(() => {
      setLabelBacklinks(null);
    });
  }, [editor.activeDocumentSignal, labelBacklinks]);

  const closeLabelBacklinks = useCallback(() => {
    setLabelBacklinks(null);
  }, []);

  const showLabelBacklinks = useCallback(() => {
    const view = editor.editorState?.view;
    if (!view || !editor.currentPath?.endsWith(".md")) {
      window.alert(LABEL_ACTION_MESSAGE);
      return;
    }

    void (async () => {
      const { resolveDocumentLabelBacklinks } = await import(
        "../../semantics/document-label-backlinks"
      );
      if (!isCurrentEditorView(editor.currentPath, view)) {
        return;
      }
      const lookup = resolveDocumentLabelBacklinks(view.state);
      if (lookup.kind === "ready") {
        if (!isCurrentEditorView(editor.currentPath, view)) {
          return;
        }
        setLabelBacklinks(lookup.result);
        return;
      }

      if (lookup.kind === "duplicate") {
        window.alert(
          `Local label "${lookup.id}" is defined more than once in this document. Resolve the duplicate label before showing references.`,
        );
        return;
      }

      window.alert(LABEL_ACTION_MESSAGE);
    })();
  }, [editor.currentPath, editor.editorState?.view, isCurrentEditorView]);

  const renameDocumentLabel = useCallback(() => {
    const view = editor.editorState?.view;
    if (!view || !editor.currentPath?.endsWith(".md")) {
      window.alert(LABEL_ACTION_MESSAGE);
      return;
    }

    void (async () => {
      const {
        prepareDocumentLabelRename,
        resolveDocumentLabelRenameTarget,
      } = await import("../../semantics/document-label-rename");
      const requestPath = editor.currentPath;
      if (!isCurrentEditorView(requestPath, view)) {
        return;
      }
      const lookup = resolveDocumentLabelRenameTarget(view.state);
      if (lookup.kind === "duplicate") {
        window.alert(duplicateRenameMessage(lookup.id));
        return;
      }
      if (lookup.kind === "none") {
        window.alert(LABEL_ACTION_MESSAGE);
        return;
      }

      const target = lookup.target;
      const promptedId = window.prompt(
        renamePromptMessage(target),
        target.definition.id,
      );
      if (promptedId === null || promptedId === target.definition.id) {
        return;
      }

      const rename = prepareDocumentLabelRename(view.state, promptedId);
      if (rename.kind === "ready") {
        if (rename.changes.length === 0) return;
        if (!isCurrentEditorView(requestPath, view)) {
          return;
        }
        if (dispatchIfConnected(
          view,
          { changes: [...rename.changes], scrollIntoView: true },
          { context: "[rename-label] dispatch failed:" },
        )) {
          view.focus();
          window.requestAnimationFrame(() => {
            if (view.dom.isConnected) {
              view.focus();
            }
          });
        }
        return;
      }

      if (rename.kind === "duplicate") {
        window.alert(duplicateRenameMessage(rename.id));
        return;
      }
      if (rename.kind === "invalid") {
        if (rename.validation.reason === "collision") {
          window.alert(
            `Local label "${rename.validation.id}" already exists in this document. Choose a different id.`,
          );
        } else {
          window.alert(renameValidationMessage(promptedId));
        }
        return;
      }

      window.alert(LABEL_ACTION_MESSAGE);
    })();
  }, [editor.currentPath, editor.editorState?.view, isCurrentEditorView]);

  return {
    labelBacklinks,
    closeLabelBacklinks,
    showLabelBacklinks,
    renameDocumentLabel,
  };
}
