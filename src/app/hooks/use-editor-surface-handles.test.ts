import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSurfaceHandles } from "./use-editor-surface-handles";

const mediaInvalidationMocks = vi.hoisted(() => ({
  invalidateImageDataUrl: vi.fn(),
  invalidatePdfPreview: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../../render/image-url-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../render/image-url-cache")>();
  return {
    ...actual,
    invalidateImageDataUrl: mediaInvalidationMocks.invalidateImageDataUrl,
  };
});

vi.mock("../../render/pdf-preview-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../render/pdf-preview-cache")>();
  return {
    ...actual,
    invalidatePdfPreview: mediaInvalidationMocks.invalidatePdfPreview,
  };
});

interface HarnessRef {
  result: ReturnType<typeof useEditorSurfaceHandles>;
}

function createHarness(): { readonly Harness: FC; readonly ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as ReturnType<typeof useEditorSurfaceHandles>,
  };

  const Harness: FC = () => {
    ref.result = useEditorSurfaceHandles({
      handleCmGotoLine: vi.fn(),
      handleCmOutlineSelect: vi.fn(),
      syncView: vi.fn(),
    });
    return null;
  };

  return { Harness, ref };
}

describe("useEditorSurfaceHandles", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => root.unmount());
    container.remove();
  });

  it("warns instead of silently no-oping when no editor surface can insert an image", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { Harness, ref } = createHarness();

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.handleInsertImage();
    });

    expect(warn).toHaveBeenCalledWith(
      "[editor] Insert Image is unavailable until an editor surface is ready.",
    );
  });

  it("invalidates CM6 image/PDF caches for watched path changes", async () => {
    const view = { dom: { isConnected: true } };
    const { Harness, ref } = createHarness();

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.handleEditorStateChange({ view } as Parameters<typeof ref.result.handleEditorStateChange>[0]);
      ref.result.handleWatchedPathChange("assets/diagram.pdf");
    });

    await vi.waitFor(() => {
      expect(mediaInvalidationMocks.invalidateImageDataUrl)
        .toHaveBeenCalledWith(view, "assets/diagram.pdf");
      expect(mediaInvalidationMocks.invalidatePdfPreview)
        .toHaveBeenCalledWith(view, "assets/diagram.pdf");
    });
  });
});
