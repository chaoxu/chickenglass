import type { ActiveDocumentSignal } from "../active-document-signal";
import { useAutoSave, type UseAutoSaveReturn } from "./use-auto-save";
import { useWindowCloseGuard } from "./use-window-close-guard";

export interface AppSaveLifecycleDeps {
  activeDocumentSignal: ActiveDocumentSignal;
  autoSaveInterval: number;
  autosaveSuspended: boolean;
  currentPath: string | null;
  hasDirtyDocument: boolean;
  handleWindowCloseRequest: () => Promise<boolean>;
  saveFile: () => Promise<void>;
}

export function useAppSaveLifecycle({
  activeDocumentSignal,
  autoSaveInterval,
  autosaveSuspended,
  currentPath,
  hasDirtyDocument,
  handleWindowCloseRequest,
  saveFile,
}: AppSaveLifecycleDeps): UseAutoSaveReturn {
  const autoSave = useAutoSave(
    hasDirtyDocument,
    saveFile,
    autoSaveInterval,
    autosaveSuspended,
    {
      activeDocumentSignal,
      currentPath,
    },
  );

  useWindowCloseGuard({
    hasDirtyDocument,
    handleWindowCloseRequest,
  });

  return autoSave;
}
