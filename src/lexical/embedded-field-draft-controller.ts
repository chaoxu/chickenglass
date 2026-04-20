import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

export type EmbeddedFieldDraftPublishPolicy = "immediate" | "on-commit";

export interface EmbeddedFieldDraftController {
  readonly draft: string;
  readonly pendingDraftRef: MutableRefObject<string | null>;
  readonly commitDraft: () => void;
  readonly resetDraft: (
    nextValue?: string,
    options?: { readonly clearPending?: boolean },
  ) => void;
  readonly revertDraft: (
    nextValue?: string,
    options?: { readonly publish?: boolean },
  ) => void;
  readonly updateDraft: (nextValue: string) => string;
}

export interface UseEmbeddedFieldDraftControllerOptions {
  readonly keepPendingAfterImmediatePublish?: boolean;
  readonly normalize?: (value: string) => string;
  readonly onPublish?: (value: string) => void;
  readonly publishPolicy: EmbeddedFieldDraftPublishPolicy;
  readonly syncExternalValue?: boolean;
  readonly value: string;
}

function identity(value: string): string {
  return value;
}

export function useEmbeddedFieldDraftController({
  keepPendingAfterImmediatePublish = false,
  normalize = identity,
  onPublish,
  publishPolicy,
  syncExternalValue = true,
  value,
}: UseEmbeddedFieldDraftControllerOptions): EmbeddedFieldDraftController {
  const [draft, setDraftState] = useState(() => normalize(value));
  const draftRef = useRef(draft);
  const lastExternalValueRef = useRef(value);
  const pendingDraftRef = useRef<string | null>(null);

  const setDraft = useCallback((nextDraft: string) => {
    draftRef.current = nextDraft;
    setDraftState(nextDraft);
  }, []);

  const publish = useCallback((nextDraft: string) => {
    if (nextDraft !== normalize(value)) {
      onPublish?.(nextDraft);
    }
  }, [normalize, onPublish, value]);

  useEffect(() => {
    if (!syncExternalValue || value === lastExternalValueRef.current) {
      return;
    }
    lastExternalValueRef.current = value;
    if (pendingDraftRef.current !== null) {
      return;
    }
    setDraft(normalize(value));
  }, [normalize, setDraft, syncExternalValue, value]);

  const resetDraft = useCallback((
    nextValue = value,
    options?: { readonly clearPending?: boolean },
  ) => {
    const normalized = normalize(nextValue);
    if (options?.clearPending !== false) {
      pendingDraftRef.current = null;
    }
    setDraft(normalized);
  }, [normalize, setDraft, value]);

  const updateDraft = useCallback((nextValue: string): string => {
    const normalized = normalize(nextValue);
    pendingDraftRef.current = normalized;
    setDraft(normalized);
    if (publishPolicy === "immediate") {
      publish(normalized);
      if (!keepPendingAfterImmediatePublish) {
        pendingDraftRef.current = null;
      }
    }
    return normalized;
  }, [keepPendingAfterImmediatePublish, normalize, publish, publishPolicy, setDraft]);

  const commitDraft = useCallback(() => {
    const nextDraft = pendingDraftRef.current ?? draftRef.current;
    publish(nextDraft);
    pendingDraftRef.current = null;
  }, [publish]);

  const revertDraft = useCallback((
    nextValue = value,
    options?: { readonly publish?: boolean },
  ) => {
    const normalized = normalize(nextValue);
    pendingDraftRef.current = null;
    setDraft(normalized);
    if (options?.publish !== false) {
      publish(normalized);
    }
  }, [normalize, publish, setDraft, value]);

  return {
    commitDraft,
    draft,
    pendingDraftRef,
    resetDraft,
    revertDraft,
    updateDraft,
  };
}
