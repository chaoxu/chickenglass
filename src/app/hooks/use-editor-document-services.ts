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
import {
  extractIncludePaths,
  resolveIncludesFromContent,
  flattenIncludesWithSourceMap,
  IncludeCycleError,
  IncludeNotFoundError,
} from "../../plugins";
import type { FileSystem } from "../file-manager";
import { SourceMap, type IncludeRegion } from "../source-map";
import { dispatchIfConnected } from "../lib/view-dispatch";
import { useBibliography } from "./use-bibliography";
import { measureAsync } from "../perf";
import { programmaticDocumentChangeAnnotation } from "../../editor/programmatic-document-change";
import { setIncludeRegionsEffect } from "../../lib/include-regions";

/**
 * Expand include directives in a document, producing a flattened text
 * and a source-map that tracks which regions originated from which file.
 *
 * Nested includes inside included files are expanded recursively.
 * Cycles are detected and cause a graceful fallback to the original content.
 *
 * Fallback behavior: if any included file cannot be read or a cycle is
 * detected, the function returns `{ text: rawContent, regions: [] }` —
 * the original content unchanged with no source map.
 */
async function expandIncludes(
  mainPath: string,
  rawContent: string,
  fs: FileSystem,
): Promise<{ text: string; regions: IncludeRegion[] }> {
  return measureAsync("includes.expand", async () => {
    const paths = extractIncludePaths(rawContent);
    if (paths.length === 0) return { text: rawContent, regions: [] };

    let includes;
    try {
      includes = await resolveIncludesFromContent(mainPath, rawContent, fs);
    } catch (e: unknown) {
      if (e instanceof IncludeCycleError) {
        console.warn("[includes] cycle detected, skipping expansion:", e.message);
        return { text: rawContent, regions: [] };
      }
      if (e instanceof IncludeNotFoundError) {
        console.warn("[includes] file not found, skipping expansion:", e.message);
        return { text: rawContent, regions: [] };
      }
      throw e;
    }

    const result = flattenIncludesWithSourceMap(rawContent, includes);
    return {
      text: result.text,
      regions: result.regions.map(function toRegion(r): IncludeRegion {
        return {
          from: r.from,
          to: r.to,
          file: r.file,
          originalRef: r.originalRef,
          rawFrom: r.rawFrom,
          rawTo: r.rawTo,
          children: r.children.map(toRegion),
        };
      }),
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
  onSourceMapChange?: (sourceMap: SourceMap | null) => void;
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
    docOverride?: string,
  ) => void;
}

export function useEditorDocumentServices({
  doc,
  fs,
  docPath,
  onSourceMapChange,
}: UseEditorDocumentServicesOptions): UseEditorDocumentServicesReturn {
  const bibliography = useBibliography({ fs, docPath });
  const imageSaverRef = useRef<((file: File) => Promise<string>) | null>(null);
  const includeExpansionGenerationRef = useRef(0);

  const publishSourceMap = useCallback((sourceMap: SourceMap | null) => {
    window.__cfSourceMap = sourceMap;
    onSourceMapChange?.(sourceMap);
  }, [onSourceMapChange]);

  const beginIncludeExpansion = useCallback(() => {
    includeExpansionGenerationRef.current += 1;
    return includeExpansionGenerationRef.current;
  }, []);

  const resetServices = useCallback(() => {
    bibliography.resetTracking();
    imageSaverRef.current = null;
    publishSourceMap(null);
    includeExpansionGenerationRef.current += 1;
  }, [bibliography, publishSourceMap]);

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
    docOverride?: string,
  ) => {
    const bibliographyPath = frontmatter?.config.bibliography ?? "";
    const cslPath = frontmatter?.config.csl ?? "";
    bibliography.loadInitial(bibliographyPath, cslPath, view);

    const sourceDoc = docOverride ?? doc;
    const includeExpansionGeneration = beginIncludeExpansion();
    publishSourceMap(null);
    if (fs && docPath) {
      void (async () => {
        try {
          const { text: expanded, regions } = await expandIncludes(docPath, sourceDoc, fs);
          if (includeExpansionGenerationRef.current !== includeExpansionGeneration) return;
          if (expanded === sourceDoc) return;
          const dispatched = dispatchIfConnected(
            view,
            {
              changes: { from: 0, to: view.state.doc.length, insert: expanded },
              effects: setIncludeRegionsEffect.of(
                regions.map(({ from, to, file }) => ({ from, to, file })),
              ),
              annotations: programmaticDocumentChangeAnnotation.of(true),
            },
            { context: "Include expansion dispatch error:" },
          );
          if (includeExpansionGenerationRef.current !== includeExpansionGeneration) return;
          if (dispatched && regions.length > 0) {
            publishSourceMap(new SourceMap(regions));
          }
        } catch (e: unknown) {
          if (includeExpansionGenerationRef.current !== includeExpansionGeneration) return;
          console.error("[editor] expandIncludes failed", e);
        }
      })();
    }
  }, [beginIncludeExpansion, bibliography, doc, docPath, fs, publishSourceMap]);

  return {
    imageSaverRef,
    resetServices,
    createDocumentContextExtensions,
    handleFrontmatterChange,
    initializeView,
  };
}
