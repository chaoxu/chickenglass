import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSidebarLayout } from "./use-sidebar-layout";

interface MatchMediaController {
  listenerCount: () => number;
  setMatches: (matches: boolean) => void;
}

function installMatchMedia(initialMatches: boolean): MatchMediaController {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      addListener: (listener) => {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeListener: (listener) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      dispatchEvent: () => true,
    })),
  });

  return {
    listenerCount: () => listeners.size,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      const event = { matches, media: "(max-width: 640px)" } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

describe("useSidebarLayout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts collapsed on narrow viewports", () => {
    installMatchMedia(true);

    const { result } = renderHook(() => useSidebarLayout());

    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it("collapses when the viewport becomes narrow", async () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useSidebarLayout());

    expect(result.current.sidebarCollapsed).toBe(false);
    await waitFor(() => {
      expect(media.listenerCount()).toBe(1);
    });

    act(() => {
      media.setMatches(true);
    });

    await waitFor(() => {
      expect(result.current.sidebarCollapsed).toBe(true);
    });
  });
});
