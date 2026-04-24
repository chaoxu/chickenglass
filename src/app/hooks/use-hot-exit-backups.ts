import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ActiveDocumentSignal } from "../active-document-signal";
import { logCatchError } from "../lib/log-catch-error";
import { fnv1aHash } from "../save-pipeline";
import {
  createHotExitBackupStore,
  type HotExitBackupStore,
} from "../hot-exit-backups";
import type { SessionDocument } from "../editor-session-model";

const DEFAULT_HOT_EXIT_BACKUP_DELAY_MS = 7_500;

export interface UseHotExitBackupsOptions {
  activeDocumentSignal: ActiveDocumentSignal;
  currentDocument: SessionDocument | null;
  delayMs?: number;
  getCurrentBaselineHash?: () => string | null;
  getCurrentDocText: () => string;
  projectRoot: string | null;
  store?: HotExitBackupStore | null;
}

export interface UseHotExitBackupsReturn {
  deleteBackup: (path: string) => void;
  flushBackup: () => Promise<void>;
}

export function useHotExitBackups({
  activeDocumentSignal,
  currentDocument,
  delayMs = DEFAULT_HOT_EXIT_BACKUP_DELAY_MS,
  getCurrentBaselineHash,
  getCurrentDocText,
  projectRoot,
  store,
}: UseHotExitBackupsOptions): UseHotExitBackupsReturn {
  const defaultStore = useMemo(() => createHotExitBackupStore(), []);
  const activeStore = store === undefined ? defaultStore : store;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({
    activeStore,
    currentDocument,
    delayMs,
    getCurrentBaselineHash,
    getCurrentDocText,
    projectRoot,
  });
  const lastWrittenContentHashRef = useRef(new Map<string, string>());
  const operationChainRef = useRef(new Map<string, Promise<void>>());

  stateRef.current = {
    activeStore,
    currentDocument,
    delayMs,
    getCurrentBaselineHash,
    getCurrentDocText,
    projectRoot,
  };

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const enqueueBackupOperation = useCallback(
    async (cacheKey: string, operation: () => Promise<void>) => {
      const previous = operationChainRef.current.get(cacheKey) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(operation);
      operationChainRef.current.set(cacheKey, next);
      try {
        await next;
      } finally {
        if (operationChainRef.current.get(cacheKey) === next) {
          operationChainRef.current.delete(cacheKey);
        }
      }
    },
    [],
  );

  const writeBackup = useCallback(async () => {
    const state = stateRef.current;
    const document = state.currentDocument;
    if (
      !state.activeStore
      || !state.projectRoot
      || !document
      || !document.dirty
    ) {
      return;
    }

    const cacheKey = `${state.projectRoot}\0${document.path}`;
    const projectRootAtRequest = state.projectRoot;
    const pathAtRequest = document.path;

    await enqueueBackupOperation(cacheKey, async () => {
      const latestState = stateRef.current;
      const latestDocument = latestState.currentDocument;
      if (
        !latestState.activeStore
        || latestState.projectRoot !== projectRootAtRequest
        || !latestDocument?.dirty
        || latestDocument.path !== pathAtRequest
      ) {
        return;
      }

      const content = latestState.getCurrentDocText();
      const contentHash = fnv1aHash(content);
      if (lastWrittenContentHashRef.current.get(cacheKey) === contentHash) {
        return;
      }

      await latestState.activeStore.writeBackup({
        path: latestDocument.path,
        name: latestDocument.name,
        content,
        baselineHash: latestState.getCurrentBaselineHash?.() ?? undefined,
      });
      lastWrittenContentHashRef.current.set(cacheKey, contentHash);
    });
  }, [enqueueBackupOperation]);

  const scheduleBackup = useCallback(() => {
    clearTimer();
    const state = stateRef.current;
    if (
      !state.activeStore
      || !state.projectRoot
      || !state.currentDocument?.dirty
      || state.delayMs <= 0
    ) {
      return;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void writeBackup().catch(logCatchError("[hot-exit] backup write failed"));
    }, state.delayMs);
  }, [clearTimer, writeBackup]);

  useEffect(() => {
    if (!activeStore || !projectRoot || !currentDocument?.dirty) {
      clearTimer();
      return;
    }
    scheduleBackup();
  }, [
    activeStore,
    clearTimer,
    currentDocument?.dirty,
    currentDocument?.path,
    delayMs,
    projectRoot,
    scheduleBackup,
  ]);

  useEffect(() => {
    return activeDocumentSignal.subscribe(() => {
      const snapshot = activeDocumentSignal.getSnapshot();
      const currentPath = stateRef.current.currentDocument?.path ?? null;
      if (snapshot.path === currentPath) {
        scheduleBackup();
      }
    });
  }, [activeDocumentSignal, scheduleBackup]);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const deleteBackup = useCallback((path: string) => {
    const state = stateRef.current;
    if (!state.activeStore || !state.projectRoot) {
      return;
    }
    clearTimer();
    const cacheKey = `${state.projectRoot}\0${path}`;
    const activeStoreAtRequest = state.activeStore;
    const projectRootAtRequest = state.projectRoot;
    lastWrittenContentHashRef.current.delete(cacheKey);
    void enqueueBackupOperation(cacheKey, async () => {
      if (stateRef.current.projectRoot !== projectRootAtRequest) {
        return;
      }
      await activeStoreAtRequest.deleteBackup(path);
    })
      .catch(logCatchError("[hot-exit] backup delete failed"));
  }, [clearTimer, enqueueBackupOperation]);

  const flushBackup = useCallback(async () => {
    clearTimer();
    await writeBackup();
  }, [clearTimer, writeBackup]);

  return { deleteBackup, flushBackup };
}
