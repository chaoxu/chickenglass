import { useCallback, useEffect, useState } from "react";

import {
  buildDocumentLabelGraph,
  prepareDocumentLabelRename,
  resolveDocumentLabelBacklinks,
  resolveDocumentLabelRenameTarget,
  type DocumentLabelBacklinksResult,
  type DocumentLabelRenameTarget,
} from "../markdown/labels";
import type { AppEditorShellController } from "./use-app-editor-shell";

const LABEL_ACTION_MESSAGE =
  "Place the cursor on a local label definition or reference in the current document.";

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

export type LabelCommandEditor = Pick<
  AppEditorShellController,
  "currentPath" | "activeDocumentSignal" | "getCurrentDocText" | "editorHandle"
>;

export interface LabelCommandController {
  labelBacklinks: DocumentLabelBacklinksResult | null;
  closeLabelBacklinks: () => void;
  handleShowLabelBacklinks: () => void;
  handleRenameDocumentLabel: () => void;
}

export function useAppLabelCommands(editor: LabelCommandEditor): LabelCommandController {
  const [labelBacklinks, setLabelBacklinks] = useState<DocumentLabelBacklinksResult | null>(null);

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

  const handleShowLabelBacklinks = useCallback(() => {
    const handle = editor.editorHandle;
    if (!handle || !editor.currentPath?.endsWith(".md")) {
      window.alert(LABEL_ACTION_MESSAGE);
      return;
    }

    const selection = handle.getSelection();
    const lookup = resolveDocumentLabelBacklinks(
      editor.getCurrentDocText(),
      selection.from,
      selection.to,
    );
    if (lookup.kind === "ready") {
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
  }, [editor.currentPath, editor.editorHandle, editor.getCurrentDocText]);

  const handleRenameDocumentLabel = useCallback(() => {
    const handle = editor.editorHandle;
    if (!handle || !editor.currentPath?.endsWith(".md")) {
      window.alert(LABEL_ACTION_MESSAGE);
      return;
    }

    const selection = handle.getSelection();
    const currentDoc = editor.getCurrentDocText();
    const graph = buildDocumentLabelGraph(currentDoc);
    const lookup = resolveDocumentLabelRenameTarget(
      currentDoc,
      selection.from,
      selection.to,
      graph,
    );
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

    const rename = prepareDocumentLabelRename(
      currentDoc,
      selection.from,
      promptedId,
      selection.to,
      graph,
    );
    if (rename.kind === "ready") {
      if (rename.changes.length === 0) {
        return;
      }
      handle.applyChanges(rename.changes);
      handle.focus();
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
  }, [editor.currentPath, editor.editorHandle, editor.getCurrentDocText]);

  const closeLabelBacklinks = useCallback(() => setLabelBacklinks(null), []);

  return {
    labelBacklinks,
    closeLabelBacklinks,
    handleShowLabelBacklinks,
    handleRenameDocumentLabel,
  };
}
