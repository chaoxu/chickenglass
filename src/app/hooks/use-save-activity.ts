import { useCallback, useEffect, useRef, useState } from "react";

import type { ActiveDocumentSignal } from "../active-document-signal";

export type SaveActivityStatus = "failed" | "idle" | "saving";

export interface SaveActivity {
  status: SaveActivityStatus;
  message?: string;
}

export function saveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Save failed";
}

export interface UseSaveActivityOptions {
  activeDocumentSignal: ActiveDocumentSignal;
  currentPath: string | null;
}

export interface SaveActivityController {
  clearSaveFailure: () => void;
  saveActivity: SaveActivity;
  trackSaveActivity: <T>(
    task: () => Promise<T>,
    errorMessage?: (error: unknown) => string,
  ) => Promise<T>;
}

export function useSaveActivity({
  activeDocumentSignal,
  currentPath,
}: UseSaveActivityOptions): SaveActivityController {
  const [saveActivity, setSaveActivity] = useState<SaveActivity>({ status: "idle" });
  const saveActivityTokenRef = useRef(0);

  const clearSaveFailure = useCallback(() => {
    setSaveActivity((previous) =>
      previous.status === "failed" ? { status: "idle" } : previous,
    );
  }, []);

  useEffect(() => {
    saveActivityTokenRef.current += 1;
    setSaveActivity({ status: "idle" });
  }, [currentPath]);

  useEffect(() => {
    return activeDocumentSignal.subscribe(clearSaveFailure);
  }, [activeDocumentSignal, clearSaveFailure]);

  const trackSaveActivity = useCallback(async <T>(
    task: () => Promise<T>,
    errorMessage: (error: unknown) => string = saveErrorMessage,
  ): Promise<T> => {
    const saveToken = ++saveActivityTokenRef.current;
    setSaveActivity({ status: "saving" });
    try {
      const result = await task();
      setSaveActivity((previous) =>
        saveActivityTokenRef.current === saveToken && previous.status === "saving"
          ? { status: "idle" }
          : previous,
      );
      return result;
    } catch (error: unknown) {
      if (saveActivityTokenRef.current === saveToken) {
        setSaveActivity({ status: "failed", message: errorMessage(error) });
      }
      throw error;
    }
  }, []);

  return {
    clearSaveFailure,
    saveActivity,
    trackSaveActivity,
  };
}
