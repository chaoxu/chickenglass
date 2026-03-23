import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useTheme, type Theme } from "./use-theme";

interface HarnessProps {
  theme: Theme;
  themeName?: string;
}

interface HarnessRef {
  resolvedTheme: ReturnType<typeof useTheme>["resolvedTheme"] | null;
}

function createHarness() {
  const ref: HarnessRef = { resolvedTheme: null };
  const Harness: FC<HarnessProps> = ({ theme, themeName }) => {
    const result = useTheme(theme, vi.fn(), themeName);
    ref.resolvedTheme = result.resolvedTheme;
    return null;
  };
  return { Harness, ref };
}

describe("useTheme", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("style");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("style");
  });

  it("restores the selected light or dark mode when returning to the default writing theme", () => {
    const { Harness, ref } = createHarness();

    act(() => {
      root.render(createElement(Harness, { theme: "light", themeName: "nord" }));
    });
    expect(ref.resolvedTheme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    act(() => {
      root.render(createElement(Harness, { theme: "light", themeName: "default" }));
    });
    expect(ref.resolvedTheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("keeps a non-default writing theme's forced mode when the base theme setting changes", () => {
    const { Harness, ref } = createHarness();

    act(() => {
      root.render(createElement(Harness, { theme: "light", themeName: "sepia" }));
    });
    expect(ref.resolvedTheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    act(() => {
      root.render(createElement(Harness, { theme: "dark", themeName: "sepia" }));
    });
    expect(ref.resolvedTheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
