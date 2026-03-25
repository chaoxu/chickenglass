import { useCallback, useEffect, useRef, useState } from "react";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../unsaved-changes";

export interface UseUnsavedChangesDialogReturn {
  request: UnsavedChangesRequest | null;
  pendingRef: { current: boolean };
  suspensionVersionRef: { current: number };
  requestDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
  resolveDecision: (decision: UnsavedChangesDecision) => void;
  cancel: () => void;
}

export function useUnsavedChangesDialog(): UseUnsavedChangesDialogReturn {
  const [request, setRequest] = useState<UnsavedChangesRequest | null>(null);
  const pendingRef = useRef(false);
  const suspensionVersionRef = useRef(0);
  const resolverRef = useRef<((decision: UnsavedChangesDecision) => void) | null>(null);

  const resolveDecision = useCallback((decision: UnsavedChangesDecision) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    pendingRef.current = false;
    suspensionVersionRef.current += 1;
    setRequest(null);
    resolve?.(decision);
  }, []);

  const cancel = useCallback(() => {
    resolveDecision("cancel");
  }, [resolveDecision]);

  const requestDecision = useCallback((nextRequest: UnsavedChangesRequest) => {
    return new Promise<UnsavedChangesDecision>((resolve) => {
      if (resolverRef.current) {
        resolveDecision("cancel");
      }
      suspensionVersionRef.current += 1;
      pendingRef.current = true;
      resolverRef.current = (decision) => {
        pendingRef.current = false;
        resolve(decision);
      };
      setRequest(nextRequest);
    });
  }, [resolveDecision]);

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        pendingRef.current = false;
        suspensionVersionRef.current += 1;
        resolverRef.current("cancel");
        resolverRef.current = null;
      }
    };
  }, []);

  return {
    request,
    pendingRef,
    suspensionVersionRef,
    requestDecision,
    resolveDecision,
    cancel,
  };
}
