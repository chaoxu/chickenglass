import { useRef, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { frontmatterField, type FrontmatterState } from "../../editor/frontmatter-state";
import { imagePasteExtension } from "../../editor/image-paste";
import { imageDropExtension } from "../../editor/image-drop";
import { createImageSaver, type ImageSaveContext } from "../../editor/image-save";
import {
  extractIncludePaths,
  resolveIncludePath,
  flattenIncludesWithSourceMap,
  type ResolvedInclude,
} from "../../plugins/include-resolver";
import type { FileSystem } from "../file-manager";
import type { IncludeRegion } from "../source-map";
import { useBibliography } from "./use-bibliography";
import { measureAsync } from "../perf";

async function expandIncludes(
  mainPath: string,
  rawContent: string,
  fs: FileSystem,
): Promise<{ text: string; regions: IncludeRegion[] }> {
  return measureAsync("includes.expand", async () => {
    const paths = extractIncludePaths(rawContent);
    if (paths.length === 0) return { text: rawContent, regions: [] };

    const includes: ResolvedInclude[] = [];
    for (const rawPath of paths) {
      const resolved = resolveIncludePath(mainPath, rawPath);
      let content: string;
      try {
        content = await fs.readFile(resolved);
      } catch {
        return { text: rawContent, regions: [] };
      }
      includes.push({ path: resolved, content, children: [] });
    }

    const result = flattenIncludesWithSourceMap(rawContent, includes);
    return {
      text: result.text,
      regions: result.regions.map((region) => ({
        from: region.from,
        to: region.to,
        file: region.file,
        originalRef: region.originalRef,
        rawFrom: region.rawFrom,
        rawTo: region.rawTo,
      })),
    };
  }, {
    category: "includes",
    detail: mainPath,
  });
}

interface UseEditorDocumentServicesOptions {
  doc: string;
  fs?: FileSystem;
  docPath?: string;
}

export interface UseEditorDocumentServicesReturn {
  imageSaverRef: React.RefObject<((file: File) => Promise<string>) | null>;
  resetServices: () => void;
  createExtensions: (baseExtensions: readonly Extension[]) => Extension[];
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
  doc,
  fs,
  docPath,
}: UseEditorDocumentServicesOptions): UseEditorDocumentServicesReturn {
  const bibliography = useBibliography({ fs, docPath });
  const imageSaverRef = useRef<((file: File) => Promise<string>) | null>(null);

  const resetServices = useCallback(() => {
    bibliography.resetTracking();
    imageSaverRef.current = null;
  }, [bibliography]);

  const createExtensions = useCallback((baseExtensions: readonly Extension[]) => {
    let currentImageFolder: string | undefined;
    const imageSaveCtx: ImageSaveContext = {
      fs,
      docPath,
      get imageFolder() {
        return currentImageFolder;
      },
    };
    const imageSaver = createImageSaver(imageSaveCtx);
    imageSaverRef.current = imageSaver;

    const imageAwareUpdateListener = EditorView.updateListener.of((update) => {
      const frontmatter = update.state.field(frontmatterField, false);
      currentImageFolder = frontmatter?.config.imageFolder;
    });

    return [
      ...baseExtensions,
      imageAwareUpdateListener,
      imagePasteExtension({ saveImage: imageSaver }),
      imageDropExtension({ saveImage: imageSaver }),
    ];
  }, [docPath, fs]);

  const handleFrontmatterChange = useCallback((
    frontmatter: FrontmatterState | undefined,
    view: EditorView,
  ) => {
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

    if (fs && docPath) {
      void expandIncludes(docPath, doc, fs).then(({ text: expanded, regions }) => {
        if (expanded === doc) return;
        if (view.dom.isConnected) {
          if (regions.length > 0) {
            (window as unknown as { __cgSourceMap?: { regions: IncludeRegion[] } }).__cgSourceMap = { regions };
          }
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: expanded },
          });
        }
      });
    }
  }, [bibliography, doc, docPath, fs]);

  return {
    imageSaverRef,
    resetServices,
    createExtensions,
    handleFrontmatterChange,
    initializeView,
  };
}
