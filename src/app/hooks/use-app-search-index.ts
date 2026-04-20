import { useEffect, useMemo, useState } from "react";

import { BackgroundIndexer } from "../../index";
import type { FileSystem } from "../file-manager";
import { listAllMarkdownFiles, readProjectTextFiles } from "../project-file-enumerator";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { UseDialogsReturn } from "./use-dialogs";

export type SearchIndexDialogs = Pick<UseDialogsReturn, "searchOpen">;

export type SearchIndexEditor = Pick<
  AppEditorShellController,
  "currentPath" | "activeDocumentSignal" | "peekCurrentDocText"
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
        ? editor.peekCurrentDocText()
        : ""
    ),
    [dialogs.searchOpen, editor.currentPath, searchSyncRevision, editor.peekCurrentDocText],
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

    const controller = new AbortController();

    void (async () => {
      try {
        const markdownPaths = await listAllMarkdownFiles({
          fs,
          signal: controller.signal,
        });
        const overrides = editor.currentPath
          ? new Map([[editor.currentPath, activeSearchDoc]])
          : undefined;
        const files = await readProjectTextFiles(
          fs,
          markdownPaths,
          {
            contentOverrides: overrides,
            signal: controller.signal,
          },
        );

        if (!controller.signal.aborted) {
          await indexer.bulkUpdate(files);
          setSearchVersion((version) => version + 1);
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          console.error("[search] failed to build app search index", error);
        }
      }
    })();

    return () => {
      controller.abort();
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
