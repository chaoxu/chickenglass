import { useRef, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { FrontmatterState } from "../../editor/frontmatter-state";
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
import { SourceMap, type IncludeRegion } from "../source-map";
import { dispatchIfConnected } from "../lib/view-dispatch";
import { useBibliography } from "./use-bibliography";
import { measureAsync } from "../perf";

/**
 * Expand `!include` directives in a document, producing a flattened text
 * and a source-map that tracks which regions originated from which file.
 *
 * Algorithm (O(n) in number of include directives):
 * 1. `extractIncludePaths` scans `rawContent` for all `!include` lines.
 * 2. Each path is resolved relative to `mainPath` and read from `fs`.
 * 3. `flattenIncludesWithSourceMap` splices the included content into
 *    `rawContent`, replacing each include directive with the file's text,
 *    and records `IncludeRegion` entries mapping flattened offsets back
 *    to their original files.
 *
 * Cycle detection: deliberately not implemented at this layer — callers
 * are expected to avoid circular includes. The function is intentionally
 * shallow (one level); nested includes inside included files are not
 * re-expanded.
 *
 * Fallback behavior: if **any** included file cannot be read, the function
 * returns `{ text: rawContent, regions: [] }` — i.e. the original content
 * unchanged with no source map. This is intentional so that a missing
 * include file does not silently corrupt the rest of the document.
 *
 * Performance: wrapped in `measureAsync("includes.expand", …)` so the
 * duration appears in the frontend perf panel.
 */
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
      } catch (_e) {
        // best-effort: included file unreadable, fall back to raw content without includes
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

  const imageFolderRef = useRef<string | undefined>(undefined);

  const createExtensions = useCallback((baseExtensions: readonly Extension[]) => {
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
      ...baseExtensions,
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

    if (fs && docPath) {
      void expandIncludes(docPath, doc, fs).then(({ text: expanded, regions }) => {
        if (expanded === doc) return;
        const dispatched = dispatchIfConnected(
          view,
          { changes: { from: 0, to: view.state.doc.length, insert: expanded } },
          { context: "Include expansion dispatch error:" },
        );
        if (dispatched && regions.length > 0) {
          window.__cfSourceMap = new SourceMap(regions);
        }
      }).catch((e: unknown) => {
        console.error("[editor] expandIncludes failed", e);
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
