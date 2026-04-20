import { useEffect, useRef } from "react";

export interface SurfaceScrollPosition {
  readonly left: number;
  readonly top: number;
}

export interface SurfaceOverlaySyncContext {
  readonly rootElement: HTMLElement;
  readonly scrollPosition: SurfaceScrollPosition;
  readonly surfaceElement: HTMLElement;
}

export type SurfaceOverlaySync = () => void;

interface SurfaceOverlaySyncOptions {
  readonly fallbackDelayMs?: number;
  readonly observeRootScroll?: boolean;
  readonly onClear: () => void;
  readonly onSync: (context: SurfaceOverlaySyncContext) => void;
  readonly rootElement: HTMLElement | null;
  readonly subscribe?: (sync: SurfaceOverlaySync) => (() => void) | undefined;
  readonly surfaceElement: HTMLElement | null;
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function useSurfaceOverlaySync({
  fallbackDelayMs = 120,
  observeRootScroll = false,
  onClear,
  onSync,
  rootElement,
  subscribe,
  surfaceElement,
}: SurfaceOverlaySyncOptions): void {
  const onClearRef = useLatestRef(onClear);
  const onSyncRef = useLatestRef(onSync);

  useEffect(() => {
    if (!rootElement || !surfaceElement) {
      onClearRef.current();
      return undefined;
    }

    let raf = 0;
    let timeout = 0;

    const commit = () => {
      if (!rootElement.isConnected || !surfaceElement.isConnected) {
        onClearRef.current();
        return;
      }

      onSyncRef.current({
        rootElement,
        scrollPosition: {
          left: surfaceElement.scrollLeft,
          top: surfaceElement.scrollTop,
        },
        surfaceElement,
      });
    };

    const sync = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
      raf = requestAnimationFrame(commit);
      timeout = window.setTimeout(commit, fallbackDelayMs);
    };

    sync();
    surfaceElement.addEventListener("scroll", sync, { passive: true });
    if (observeRootScroll && surfaceElement !== rootElement) {
      rootElement.addEventListener("scroll", sync, { passive: true });
    }
    window.addEventListener("resize", sync);
    const unsubscribe = subscribe?.(sync);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
      surfaceElement.removeEventListener("scroll", sync);
      if (observeRootScroll && surfaceElement !== rootElement) {
        rootElement.removeEventListener("scroll", sync);
      }
      window.removeEventListener("resize", sync);
      unsubscribe?.();
    };
  }, [
    fallbackDelayMs,
    observeRootScroll,
    onClearRef,
    onSyncRef,
    rootElement,
    subscribe,
    surfaceElement,
  ]);
}
