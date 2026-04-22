/**
 * useBibliography — loads BibTeX + CSL files when frontmatter bibliography
 * paths change and dispatches bibDataEffect to the CM6 view.
 *
 * Extracted from useEditor so bibliography concerns are isolated.
 */

import { useRef, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import type { CslJsonItem } from "../../citations/bibtex-parser";
import { type BibStore, bibDataEffect } from "../../state/bib-data";
import { CslProcessor } from "../../citations/csl-processor";
import type { FileSystem } from "../file-manager";
import { logCatchError } from "../lib/log-catch-error";
import { projectPathCandidatesFromDocument } from "../lib/project-paths";
import { dispatchIfConnected } from "../lib/view-dispatch";
import { measureAsync, withPerfOperation } from "../perf";

/**
 * Module-level cache for the last successful bibliography bootstrap.
 * Keyed by (bibText, cslXml) content so reopening unchanged inputs
 * skips the expensive parse + processor-creation work.
 */
interface BootstrapCacheEntry {
  readonly bibText: string;
  readonly cslXml: string | undefined;
  readonly store: ReadonlyMap<string, CslJsonItem>;
  readonly cslProcessor: CslProcessor;
}

let bootstrapCache: BootstrapCacheEntry | null = null;

async function parseBibTeXLazy(content: string): Promise<CslJsonItem[]> {
  const { parseBibTeX } = await import("../../citations/bibtex-parser");
  return parseBibTeX(content);
}

/** Clear the bootstrap cache (exposed for testing). */
export function clearBootstrapCache(): void {
  bootstrapCache = null;
}

/**
 * Load a bibliography file (and optional CSL style) relative to the document,
 * falling back to project-root resolution, then dispatch the parsed data
 * to the CM6 view.
 */
export async function loadBibliography(
  docPath: string,
  bibPath: string,
  cslPath: string,
  fs: FileSystem,
  view: EditorView,
  isCurrent?: () => boolean,
): Promise<void> {
  const readWithFallback = async (p: string): Promise<string> => {
    const candidates = projectPathCandidatesFromDocument(docPath, p);
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        return await fs.readFile(candidate);
      } catch (_e) {
        // best-effort: try next candidate path before giving up
        lastError = lastError ?? new Error(`Unable to read ${candidate}`);
      }
    }
    throw lastError ?? new Error(`Unable to read ${p}`);
  };

  await withPerfOperation("citations.load", async (operation) => {
    try {
      const bibText = await operation.measureAsync("citations.read_bib", () => readWithFallback(bibPath), {
        category: "citations",
        detail: bibPath,
      });
      if (isCurrent && !isCurrent()) return;

      let cslXml: string | undefined;
      if (cslPath) {
        try {
          cslXml = await measureAsync("citations.read_csl", () => readWithFallback(cslPath), {
            category: "citations",
            detail: cslPath,
          });
          if (isCurrent && !isCurrent()) return;
        } catch (_e) {
          // best-effort: CSL file not found — use default style
        }
      }

      // Reuse cached bootstrap artifacts when inputs are unchanged.
      if (bootstrapCache && bootstrapCache.bibText === bibText && bootstrapCache.cslXml === cslXml) {
        dispatchIfConnected(
          view,
          { effects: bibDataEffect.of({ store: bootstrapCache.store, cslProcessor: bootstrapCache.cslProcessor }) },
          { context: "Bibliography dispatch error:" },
        );
        return;
      }

      const items = await operation.measureAsync("citations.parse_bib", () => parseBibTeXLazy(bibText), {
        category: "citations",
        detail: bibPath,
      });
      const store: BibStore = new Map(items.map((item) => [item.id, item]));

      const cslProcessor = await operation.measureAsync(
        "citations.create_processor",
        () => CslProcessor.create(items, cslXml),
        { category: "citations", detail: cslPath || bibPath },
      );
      if (isCurrent && !isCurrent()) return;

      bootstrapCache = { bibText, cslXml, store, cslProcessor };
      dispatchIfConnected(
        view,
        { effects: bibDataEffect.of({ store, cslProcessor }) },
        { context: "Bibliography dispatch error:" },
      );
    } catch (error: unknown) {
      if (isCurrent && !isCurrent()) return;
      console.warn("[bibliography] failed to load bibliography, using empty data", { bibPath, cslPath }, error);
      dispatchIfConnected(
        view,
        { effects: bibDataEffect.of({ store: new Map(), cslProcessor: CslProcessor.empty() }) },
        { context: "Bibliography dispatch error:" },
      );
    }
  }, bibPath);
}

export interface UseBibliographyOptions {
  /** Filesystem for reading bib/csl files. */
  fs?: FileSystem;
  /** Path of the current document (for relative resolution). */
  docPath?: string;
}

export interface UseBibliographyReturn {
  /** Ref tracking the last loaded bib path (to avoid redundant reloads). */
  lastBibPathRef: React.RefObject<string>;
  /** Ref tracking the last loaded CSL path. */
  lastCslPathRef: React.RefObject<string>;
  /**
   * Check if bib/csl paths changed and trigger a reload if so.
   * Called from the updateListener when frontmatter changes.
   */
  handleBibChange: (
    bibPath: string,
    cslPath: string,
    view: EditorView,
  ) => void;
  /** Reset bib/csl tracking (call when editor is recreated). */
  resetTracking: () => void;
  /** Perform initial bibliography load for a new editor view. */
  loadInitial: (bibPath: string, cslPath: string, view: EditorView) => void;
}

export function useBibliography(options: UseBibliographyOptions): UseBibliographyReturn {
  const { fs, docPath } = options;
  const lastBibPathRef = useRef("");
  const lastCslPathRef = useRef("");
  const loadGenerationRef = useRef(0);

  const beginLoad = useCallback(() => {
    loadGenerationRef.current += 1;
    return loadGenerationRef.current;
  }, []);

  const resetTracking = useCallback(() => {
    lastBibPathRef.current = "";
    lastCslPathRef.current = "";
    loadGenerationRef.current += 1;
  }, []);

  const handleBibChange = useCallback(
    (bibPath: string, cslPath: string, view: EditorView) => {
      if (!fs || !docPath) return;
      if (
        bibPath === lastBibPathRef.current &&
        cslPath === lastCslPathRef.current
      ) {
        return;
      }

      lastBibPathRef.current = bibPath;
      lastCslPathRef.current = cslPath;
      const generation = beginLoad();

      if (!bibPath) {
        dispatchIfConnected(
          view,
          { effects: bibDataEffect.of({ store: new Map(), cslProcessor: CslProcessor.empty() }) },
          { context: "Bibliography dispatch error:" },
        );
      } else {
        void loadBibliography(
          docPath,
          bibPath,
          cslPath,
          fs,
          view,
          () => loadGenerationRef.current === generation,
        ).catch(logCatchError("[bibliography] loadBibliography failed"));
      }
    },
    [beginLoad, fs, docPath],
  );

  const loadInitial = useCallback(
    (bibPath: string, cslPath: string, view: EditorView) => {
      if (!fs || !docPath) return;
      lastBibPathRef.current = bibPath;
      lastCslPathRef.current = cslPath;
      const generation = beginLoad();
      if (bibPath) {
        void loadBibliography(
          docPath,
          bibPath,
          cslPath,
          fs,
          view,
          () => loadGenerationRef.current === generation,
        ).catch(logCatchError("[bibliography] loadBibliography (initial) failed"));
      }
    },
    [beginLoad, fs, docPath],
  );

  return {
    lastBibPathRef,
    lastCslPathRef,
    handleBibChange,
    resetTracking,
    loadInitial,
  };
}
