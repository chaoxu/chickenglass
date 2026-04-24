/**
 * useBibliography — loads BibTeX + CSL files when frontmatter bibliography
 * paths change and dispatches bibDataEffect to the CM6 view.
 *
 * Extracted from useEditor so bibliography concerns are isolated.
 */

import { useRef, useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import type { CslJsonItem } from "../../citations/bibtex-parser";
import {
  type BibStore,
  bibDataEffect,
  type BibliographyFailureKind,
  type BibliographyStatus,
} from "../../state/bib-data";
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

export interface BibliographyLoadData {
  readonly store: BibStore;
  readonly cslProcessor: CslProcessor;
  readonly status: BibliographyStatus;
}

async function parseBibTeXLazy(content: string): Promise<CslJsonItem[]> {
  const { parseBibTeX } = await import("../../citations/bibtex-parser");
  return parseBibTeX(content);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function bibliographyFailureStatus(
  state: "error" | "warning",
  kind: BibliographyFailureKind,
  bibPath: string,
  cslPath: string,
  error: unknown,
  fallback: string,
): BibliographyStatus {
  return {
    state,
    kind,
    bibPath,
    ...(cslPath ? { cslPath } : {}),
    message: errorMessage(error, fallback),
  };
}

function bibliographyLoadedStatus(
  bibPath: string,
  cslPath: string,
  cslProcessor: CslProcessor,
  styleWarning: BibliographyStatus | null,
): BibliographyStatus {
  if (styleWarning) return styleWarning;
  if (cslPath && cslProcessor.styleStatus.state === "error") {
    return {
      state: "warning",
      kind: "style-csl",
      bibPath,
      cslPath,
      message: cslProcessor.styleStatus.message,
    };
  }
  return { state: "ok", bibPath, ...(cslPath ? { cslPath } : {}) };
}

function dispatchBibliographyData(
  view: EditorView,
  store: BibStore,
  cslProcessor: CslProcessor,
  status: BibliographyStatus,
): void {
  dispatchIfConnected(
    view,
    { effects: bibDataEffect.of({ store, cslProcessor, status }) },
    { context: "Bibliography dispatch error:" },
  );
}

/** Clear the bootstrap cache (exposed for testing). */
export function clearBootstrapCache(): void {
  bootstrapCache = null;
}

export async function loadBibliographyData(
  docPath: string,
  bibPath: string,
  cslPath: string,
  fs: FileSystem,
  isCurrent?: () => boolean,
): Promise<BibliographyLoadData | null> {
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

  return withPerfOperation("citations.load", async (operation) => {
    try {
      let bibText: string;
      try {
        bibText = await operation.measureAsync("citations.read_bib", () => readWithFallback(bibPath), {
          category: "citations",
          detail: bibPath,
        });
      } catch (error: unknown) {
        if (isCurrent && !isCurrent()) return null;
        const status = bibliographyFailureStatus(
          "error",
          "read-bib",
          bibPath,
          cslPath,
          error,
          "Unable to read bibliography file",
        );
        console.warn("[bibliography] failed to load bibliography, using empty data", { bibPath, cslPath }, error);
        return { store: new Map(), cslProcessor: CslProcessor.empty(), status };
      }
      if (isCurrent && !isCurrent()) return null;

      let cslXml: string | undefined;
      let styleWarning: BibliographyStatus | null = null;
      if (cslPath) {
        try {
          cslXml = await measureAsync("citations.read_csl", () => readWithFallback(cslPath), {
            category: "citations",
            detail: cslPath,
          });
          if (isCurrent && !isCurrent()) return null;
        } catch (error: unknown) {
          styleWarning = bibliographyFailureStatus(
            "warning",
            "read-csl",
            bibPath,
            cslPath,
            error,
            "Unable to read CSL style; using default style",
          );
        }
      }

      // Reuse cached bootstrap artifacts when inputs are unchanged.
      if (bootstrapCache && bootstrapCache.bibText === bibText && bootstrapCache.cslXml === cslXml) {
        return {
          store: bootstrapCache.store,
          cslProcessor: bootstrapCache.cslProcessor,
          status: bibliographyLoadedStatus(bibPath, cslPath, bootstrapCache.cslProcessor, styleWarning),
        };
      }

      let items: CslJsonItem[];
      try {
        items = await operation.measureAsync("citations.parse_bib", () => parseBibTeXLazy(bibText), {
          category: "citations",
          detail: bibPath,
        });
      } catch (error: unknown) {
        if (isCurrent && !isCurrent()) return null;
        const status = bibliographyFailureStatus(
          "error",
          "parse-bib",
          bibPath,
          cslPath,
          error,
          "Unable to parse bibliography file",
        );
        console.warn("[bibliography] failed to load bibliography, using empty data", { bibPath, cslPath }, error);
        return { store: new Map(), cslProcessor: CslProcessor.empty(), status };
      }
      const store: BibStore = new Map(items.map((item) => [item.id, item]));

      const cslProcessor = await operation.measureAsync(
        "citations.create_processor",
        () => CslProcessor.create(items, cslXml),
        { category: "citations", detail: cslPath || bibPath },
      );
      if (isCurrent && !isCurrent()) return null;

      bootstrapCache = { bibText, cslXml, store, cslProcessor };
      return {
        store,
        cslProcessor,
        status: bibliographyLoadedStatus(bibPath, cslPath, cslProcessor, styleWarning),
      };
    } catch (error: unknown) {
      if (isCurrent && !isCurrent()) return null;
      const status = bibliographyFailureStatus(
        "error",
        "unexpected",
        bibPath,
        cslPath,
        error,
        "Unexpected bibliography load failure",
      );
      console.warn("[bibliography] failed to load bibliography, using empty data", { bibPath, cslPath }, error);
      return { store: new Map(), cslProcessor: CslProcessor.empty(), status };
    }
  }, bibPath);
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
  const data = await loadBibliographyData(docPath, bibPath, cslPath, fs, isCurrent);
  if (!data) return;
  dispatchBibliographyData(view, data.store, data.cslProcessor, data.status);
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
        dispatchBibliographyData(
          view,
          new Map(),
          CslProcessor.empty(),
          { state: "idle" },
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
