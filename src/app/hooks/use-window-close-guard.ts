import { useEffect, useRef } from "react";
import { isTauri } from "../../lib/tauri";

interface WindowCloseGuardDeps {
  hasDirtyDocument: boolean;
  handleWindowCloseRequest: () => Promise<boolean>;
}

export function useWindowCloseGuard({
  hasDirtyDocument,
  handleWindowCloseRequest,
}: WindowCloseGuardDeps): void {
  const handleWindowCloseRequestRef = useRef(handleWindowCloseRequest);
  const closeRequestInFlightRef = useRef(false);

  handleWindowCloseRequestRef.current = handleWindowCloseRequest;

  useEffect(() => {
    if (isTauri() || !hasDirtyDocument) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const abortController = new AbortController();
    window.addEventListener("beforeunload", handleBeforeUnload, {
      signal: abortController.signal,
    });
    return () => {
      abortController.abort();
    };
  }, [hasDirtyDocument]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const abortController = new AbortController();
    let unlisten: (() => void) | null = null;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (abortController.signal.aborted) {
        return;
      }

      const currentWindow = getCurrentWindow();
      const nextUnlisten = await currentWindow.onCloseRequested(async (event) => {
        event.preventDefault();

        if (closeRequestInFlightRef.current) {
          return;
        }

        closeRequestInFlightRef.current = true;
        try {
          const shouldClose = await handleWindowCloseRequestRef.current();
          if (shouldClose) {
            await currentWindow.destroy();
          }
        } finally {
          closeRequestInFlightRef.current = false;
        }
      });
      // The component may have unmounted while we were awaiting the Tauri
      // listener registration. If so, drop the listener immediately —
      // otherwise it stays bound to a dead component.
      if (abortController.signal.aborted) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    })().catch((error: unknown) => {
      console.error("[app] window close guard failed", error);
    });

    return () => {
      abortController.abort();
      unlisten?.();
    };
  }, []);
}
