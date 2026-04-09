import { useCallback, useEffect, useRef, useState } from "react";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../unsaved-changes";

export type UnsavedChangesDialogStatus = "idle" | "pending" | "resolved";

export interface UseUnsavedChangesDialogReturn {
  status: UnsavedChangesDialogStatus;
  request: UnsavedChangesRequest | null;
  suspensionVersion: number;
  requestDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
  resolveDecision: (decision: UnsavedChangesDecision) => void;
  cancel: () => void;
}

interface UnsavedChangesDialogState {
  status: UnsavedChangesDialogStatus;
  request: UnsavedChangesRequest | null;
  suspensionVersion: number;
}

export function useUnsavedChangesDialog(): UseUnsavedChangesDialogReturn {
  const [state, setState] = useState<UnsavedChangesDialogState>({
    status: "idle",
    request: null,
    suspensionVersion: 0,
  });
  const resolverRef = useRef<((decision: UnsavedChangesDecision) => void) | null>(null);

  const finishPendingDecision = useCallback((decision: UnsavedChangesDecision) => {
    const resolve = resolverRef.current;
    if (!resolve) {
      return;
    }
    resolverRef.current = null;
    setState((prev) => (
      prev.status === "pending"
        ? {
          status: "resolved",
          request: null,
          suspensionVersion: prev.suspensionVersion + 1,
        }
        : prev
    ));
    resolve(decision);
  }, []);

  const resolveDecision = useCallback((decision: UnsavedChangesDecision) => {
    finishPendingDecision(decision);
  }, [finishPendingDecision]);

  const cancel = useCallback(() => {
    finishPendingDecision("cancel");
  }, [finishPendingDecision]);

  const requestDecision = useCallback((nextRequest: UnsavedChangesRequest) => {
    return new Promise<UnsavedChangesDecision>((resolve) => {
      const previousResolve = resolverRef.current;
      if (previousResolve) {
        resolverRef.current = null;
        setState((prev) => (
          prev.status === "pending"
            ? {
              status: "resolved",
              request: null,
              suspensionVersion: prev.suspensionVersion + 1,
            }
            : prev
        ));
        previousResolve("cancel");
      }
      resolverRef.current = resolve;
      setState((prev) => ({
        status: "pending",
        request: nextRequest,
        suspensionVersion: prev.suspensionVersion + 1,
      }));
    });
  }, []);

  useEffect(() => {
    return () => {
      const resolve = resolverRef.current;
      if (resolve) {
        resolverRef.current = null;
        resolve("cancel");
      }
    };
  }, []);

  return {
    status: state.status,
    request: state.request,
    suspensionVersion: state.suspensionVersion,
    requestDecision,
    resolveDecision,
    cancel,
  };
}
