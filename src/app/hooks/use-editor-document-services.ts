import { useRef, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  imagePasteExtension,
  imageDropExtension,
  createImageSaver,
  type FrontmatterState,
  type ImageSaveContext,
} from "../../editor";
import { fileSystemFacet, documentPathFacet } from "../../lib/types";
import type { FileSystem } from "../file-manager";
import { useBibliography } from "./use-bibliography";

interface UseEditorDocumentServicesOptions {
  fs?: FileSystem;
  docPath?: string;
}

export interface UseEditorDocumentServicesReturn {
  imageSaverRef: React.RefObject<((file: File) => Promise<string>) | null>;
  resetServices: () => void;
  createDocumentContextExtensions: () => Extension[];
  handleFrontmatterChange: (
    frontmatter: FrontmatterState | undefined,
    view: EditorView,
  ) => void;
  initializeView: (
    view: EditorView,
    frontmatter: FrontmatterState | undefined,
  ) => void;
}

export function useEditorDocumentServices({
  fs,
  docPath,
}: UseEditorDocumentServicesOptions): UseEditorDocumentServicesReturn {
  const bibliography = useBibliography({ fs, docPath });
  const imageSaverRef = useRef<((file: File) => Promise<string>) | null>(null);

  const resetServices = useCallback(() => {
    bibliography.resetTracking();
    imageSaverRef.current = null;
  }, [bibliography]);

  const imageFolderRef = useRef<string | undefined>(undefined);

  const createDocumentContextExtensions = useCallback(() => {
    const imageSaveCtx: ImageSaveContext = {
      fs,
      docPath,
      get imageFolder() {
        return imageFolderRef.current;
      },
    };
    const imageSaver = createImageSaver(imageSaveCtx);
    imageSaverRef.current = imageSaver;

    return [
      fileSystemFacet.of(fs ?? null),
      documentPathFacet.of(docPath ?? ""),
      imagePasteExtension({ saveImage: imageSaver }),
      imageDropExtension({ saveImage: imageSaver }),
    ];
  }, [docPath, fs]);

  const handleFrontmatterChange = useCallback((
    frontmatter: FrontmatterState | undefined,
    view: EditorView,
  ) => {
    imageFolderRef.current = frontmatter?.config.imageFolder;
    const bibliographyPath = frontmatter?.config.bibliography ?? "";
    const cslPath = frontmatter?.config.csl ?? "";
    bibliography.handleBibChange(bibliographyPath, cslPath, view);
  }, [bibliography]);

  const initializeView = useCallback((
    view: EditorView,
    frontmatter: FrontmatterState | undefined,
  ) => {
    const bibliographyPath = frontmatter?.config.bibliography ?? "";
    const cslPath = frontmatter?.config.csl ?? "";
    bibliography.loadInitial(bibliographyPath, cslPath, view);
  }, [bibliography]);

  return {
    imageSaverRef,
    resetServices,
    createDocumentContextExtensions,
    handleFrontmatterChange,
    initializeView,
  };
}
