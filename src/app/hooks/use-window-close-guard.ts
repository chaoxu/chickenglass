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

  useEffect(() => {
    handleWindowCloseRequestRef.current = handleWindowCloseRequest;
  }, [handleWindowCloseRequest]);

  useEffect(() => {
    if (isTauri() || !hasDirtyDocument) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasDirtyDocument]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (cancelled) {
        return;
      }

      const currentWindow = getCurrentWindow();
      unlisten = await currentWindow.onCloseRequested(async (event) => {
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
    })().catch((error: unknown) => {
      console.error("[app] window close guard failed", error);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
