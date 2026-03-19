/**
 * useBibliography — loads BibTeX + CSL files when frontmatter bibliography
 * paths change and dispatches bibDataEffect to the CM6 view.
 *
 * Extracted from useEditor so bibliography concerns are isolated.
 */

import { useRef, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import { parseBibTeX } from "../../citations/bibtex-parser";
import { bibDataEffect } from "../../citations/citation-render";
import { CslProcessor } from "../../citations/csl-processor";
import type { FileSystem } from "../file-manager";

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
): Promise<void> {
  const dir = docPath.includes("/")
    ? docPath.slice(0, docPath.lastIndexOf("/"))
    : "";

  const readWithFallback = async (p: string): Promise<string> => {
    if (dir) {
      try {
        return await fs.readFile(`${dir}/${p}`);
      } catch {
        // Fall through to project-root resolution
      }
    }
    return fs.readFile(p);
  };

  try {
    const bibText = await readWithFallback(bibPath);
    const entries = parseBibTeX(bibText);
    const store = new Map(entries.map((e) => [e.id, e]));

    let cslXml: string | undefined;
    if (cslPath) {
      try {
        cslXml = await readWithFallback(cslPath);
      } catch {
        // CSL file not found — use default style
      }
    }

    const cslProcessor = new CslProcessor(entries, cslXml);
    try {
      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor }) });
    } catch {
      // view destroyed
    }
  } catch {
    // BibTeX file unreadable or unparseable — clear bibliography data
    try {
      view.dispatch({ effects: bibDataEffect.of({ store: new Map(), cslProcessor: null }) });
    } catch {
      // view destroyed
    }
  }
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

  const resetTracking = useCallback(() => {
    lastBibPathRef.current = "";
    lastCslPathRef.current = "";
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

      if (!bibPath) {
        try {
          view.dispatch({
            effects: bibDataEffect.of({ store: new Map(), cslProcessor: null }),
          });
        } catch {
          // view destroyed
        }
      } else {
        void loadBibliography(docPath, bibPath, cslPath, fs, view);
      }
    },
    [fs, docPath],
  );

  const loadInitial = useCallback(
    (bibPath: string, cslPath: string, view: EditorView) => {
      if (!fs || !docPath) return;
      lastBibPathRef.current = bibPath;
      lastCslPathRef.current = cslPath;
      if (bibPath) {
        void loadBibliography(docPath, bibPath, cslPath, fs, view);
      }
    },
    [fs, docPath],
  );

  return {
    lastBibPathRef,
    lastCslPathRef,
    handleBibChange,
    resetTracking,
    loadInitial,
  };
}
