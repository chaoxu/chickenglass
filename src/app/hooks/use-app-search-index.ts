import { useEffect, useMemo, useState } from "react";

import { BackgroundIndexer } from "../../index";
import type { FileSystem } from "../file-manager";
import { collectSearchableMarkdownPaths } from "../search";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { UseDialogsReturn } from "./use-dialogs";

export type SearchIndexDialogs = Pick<UseDialogsReturn, "searchOpen">;

export type SearchIndexEditor = Pick<
  AppEditorShellController,
  "currentPath" | "activeDocumentSignal" | "getCurrentDocText"
>;

export interface SearchIndexController {
  indexer: BackgroundIndexer;
  searchVersion: number;
}

export function useAppSearchIndex(
  fs: FileSystem,
  dialogs: SearchIndexDialogs,
  editor: SearchIndexEditor,
  fileTree: unknown,
): SearchIndexController {
  const [indexer] = useState(() => new BackgroundIndexer());
  const [searchSyncRevision, setSearchSyncRevision] = useState(0);
  const [searchVersion, setSearchVersion] = useState(0);

  const activeSearchDoc = useMemo(
    () => (
      dialogs.searchOpen && editor.currentPath
        ? editor.getCurrentDocText()
        : ""
    ),
    [dialogs.searchOpen, editor.currentPath, searchSyncRevision, editor.getCurrentDocText],
  );

  useEffect(() => {
    if (!dialogs.searchOpen) {
      return;
    }

    return editor.activeDocumentSignal.subscribe(() => {
      setSearchSyncRevision((revision) => revision + 1);
    });
  }, [dialogs.searchOpen, editor.activeDocumentSignal]);

  useEffect(() => {
    if (!dialogs.searchOpen) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const tree = await fs.listTree();
        const markdownPaths = collectSearchableMarkdownPaths(tree);
        const files = await Promise.all(
          markdownPaths.map(async (path) => ({
            file: path,
            content:
              path === editor.currentPath
                ? activeSearchDoc
                : await fs.readFile(path),
          })),
        );

        if (!cancelled) {
          await indexer.bulkUpdate(files);
          setSearchVersion((version) => version + 1);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          console.error("[search] failed to build app search index", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dialogs.searchOpen,
    fileTree,
    fs,
    indexer,
  ]);

  useEffect(() => {
    if (!dialogs.searchOpen || !editor.currentPath?.endsWith(".md")) {
      return;
    }

    try {
      indexer.updateFile(editor.currentPath, activeSearchDoc);
      setSearchVersion((version) => version + 1);
    } catch (error: unknown) {
      console.error("[search] failed to sync active file into app search index", error);
    }
  }, [dialogs.searchOpen, indexer, editor.currentPath, activeSearchDoc]);

  return { indexer, searchVersion };
}
