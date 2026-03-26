/**
 * Regression tests for PDF preview cache bugs:
 *
 * #486 — canvas cache eviction desyncs from StateField (permanent broken image).
 *        When canvasCache evicts the oldest entry, the StateField still says
 *        "ready", so the decoration renders PdfCanvasWidget which finds no
 *        canvas and shows a permanent broken-image placeholder.
 *
 * #473 — PDF preview "ready" state can outlive its evicted canvas (same root
 *        cause as #486). The fix in image-render.ts treats "ready" + no canvas
 *        as a cache miss and re-requests.
 *
 * #472 — PDF previews never retry after an error entry is cached. The old code
 *        returned early on any `existing` entry, so errors were permanent.
 *        The fix adds an errorTime timestamp and retries after ERROR_COOLDOWN_MS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { FileSystem } from "../lib/types";

const { rasterizeMock } = vi.hoisted(() => ({
  rasterizeMock: vi.fn(),
}));

vi.mock("./pdf-rasterizer", () => ({
  rasterizePdfPage1: rasterizeMock,
}));

import {
  pdfPreviewField,
  pdfPreviewEffect,
  pdfPreviewRemoveEffect,
  requestPdfPreview,
  getPdfCanvas,
  _resetPendingPaths,
  ERROR_COOLDOWN_MS,
} from "./pdf-preview-cache";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockFs(): FileSystem {
  return {
    listTree: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createFile: vi.fn(),
    exists: vi.fn(),
    renameFile: vi.fn(),
    createDirectory: vi.fn(),
    deleteFile: vi.fn(),
    writeFileBinary: vi.fn(),
    readFileBinary: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  };
}

/**
 * Minimal mock EditorView that supports state, dispatch, and dom.isConnected.
 * We only need the subset used by requestPdfPreview / safeDispatch.
 */
function createMockView() {
  let state = EditorState.create({
    doc: "",
    extensions: [pdfPreviewField],
  });

  const view = {
    get state() {
      return state;
    },
    dispatch(tr: { effects?: unknown }) {
      // Apply the transaction to advance state
      state = state.update(tr as Parameters<EditorState["update"]>[0]).state;
    },
    dom: { isConnected: true },
  };

  // Cast to the minimal EditorView shape used by requestPdfPreview
  return view as unknown as import("@codemirror/view").EditorView;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("pdfPreviewField", () => {
  describe("pdfPreviewRemoveEffect", () => {
    it("removes an entry from the StateField", () => {
      const state = EditorState.create({
        doc: "",
        extensions: [pdfPreviewField],
      });

      // Add an entry
      const s1 = state.update({
        effects: pdfPreviewEffect.of({
          path: "fig.pdf",
          entry: { status: "ready" },
        }),
      }).state;
      expect(s1.field(pdfPreviewField).get("fig.pdf")).toEqual({ status: "ready" });

      // Remove it
      const s2 = s1.update({
        effects: pdfPreviewRemoveEffect.of("fig.pdf"),
      }).state;
      expect(s2.field(pdfPreviewField).get("fig.pdf")).toBeUndefined();
    });

    it("is a no-op when path does not exist in the field", () => {
      const state = EditorState.create({
        doc: "",
        extensions: [pdfPreviewField],
      });

      const s1 = state.update({
        effects: pdfPreviewRemoveEffect.of("nonexistent.pdf"),
      }).state;

      // Map reference should be unchanged (no unnecessary copy)
      expect(s1.field(pdfPreviewField)).toBe(state.field(pdfPreviewField));
    });

    it("does not affect other entries", () => {
      const state = EditorState.create({
        doc: "",
        extensions: [pdfPreviewField],
      });

      const s1 = state.update({
        effects: [
          pdfPreviewEffect.of({ path: "a.pdf", entry: { status: "ready" } }),
          pdfPreviewEffect.of({ path: "b.pdf", entry: { status: "ready" } }),
        ],
      }).state;
      expect(s1.field(pdfPreviewField).size).toBe(2);

      const s2 = s1.update({
        effects: pdfPreviewRemoveEffect.of("a.pdf"),
      }).state;
      expect(s2.field(pdfPreviewField).has("a.pdf")).toBe(false);
      expect(s2.field(pdfPreviewField).get("b.pdf")).toEqual({ status: "ready" });
    });
  });
});

describe("requestPdfPreview", () => {
  beforeEach(() => {
    _resetPendingPaths();
    rasterizeMock.mockReset();
  });

  describe("#486 — canvas eviction resets StateField entry", () => {
    it("dispatches pdfPreviewRemoveEffect for the evicted path when cache is full", async () => {
      // Fill the canvas cache to capacity (64 entries) by making 64 successful requests.
      // Then add one more — the first entry should be evicted and its StateField entry removed.
      const canvas = document.createElement("canvas");
      canvas.width = 10;
      canvas.height = 10;
      rasterizeMock.mockResolvedValue(canvas);

      const fs = createMockFs();
      const view = createMockView();

      // Load 64 PDFs to fill the cache
      for (let i = 0; i < 64; i++) {
        await requestPdfPreview(view, `file${i}.pdf`, fs);
      }

      // Verify first entry is "ready"
      expect(view.state.field(pdfPreviewField).get("file0.pdf")?.status).toBe("ready");
      expect(getPdfCanvas("file0.pdf")).toBeDefined();

      // Load one more — should evict file0.pdf
      await requestPdfPreview(view, "file64.pdf", fs);

      // file0.pdf should be gone from both caches
      expect(getPdfCanvas("file0.pdf")).toBeUndefined();
      expect(view.state.field(pdfPreviewField).get("file0.pdf")).toBeUndefined();

      // file64.pdf should be ready
      expect(view.state.field(pdfPreviewField).get("file64.pdf")?.status).toBe("ready");
      expect(getPdfCanvas("file64.pdf")).toBeDefined();
    });
  });

  describe("#473 — ready + missing canvas triggers re-request", () => {
    it("re-requests when status is 'ready' but canvas is missing", async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 10;
      canvas.height = 10;
      rasterizeMock.mockResolvedValue(canvas);

      const fs = createMockFs();
      const view = createMockView();

      // First request — succeeds
      await requestPdfPreview(view, "diagram.pdf", fs);
      expect(view.state.field(pdfPreviewField).get("diagram.pdf")?.status).toBe("ready");
      expect(getPdfCanvas("diagram.pdf")).toBeDefined();

      // Simulate external canvas eviction (e.g., by another path's eviction)
      _resetPendingPaths(); // clears canvasCache

      // Manually re-set the StateField to "ready" to simulate the desync
      view.dispatch({
        effects: pdfPreviewEffect.of({
          path: "diagram.pdf",
          entry: { status: "ready" },
        }),
      });
      expect(view.state.field(pdfPreviewField).get("diagram.pdf")?.status).toBe("ready");
      expect(getPdfCanvas("diagram.pdf")).toBeUndefined();

      // requestPdfPreview should NOT skip this — it should re-request
      rasterizeMock.mockClear();
      await requestPdfPreview(view, "diagram.pdf", fs);

      expect(rasterizeMock).toHaveBeenCalledTimes(1);
      expect(view.state.field(pdfPreviewField).get("diagram.pdf")?.status).toBe("ready");
      expect(getPdfCanvas("diagram.pdf")).toBeDefined();
    });
  });

  describe("#472 — error entries allow retry after cooldown", () => {
    it("records errorTime on error entries", async () => {
      rasterizeMock.mockResolvedValue(null); // simulate rasterization failure

      const fs = createMockFs();
      const view = createMockView();

      await requestPdfPreview(view, "bad.pdf", fs);

      const entry = view.state.field(pdfPreviewField).get("bad.pdf");
      expect(entry?.status).toBe("error");
      expect(entry?.errorTime).toBeTypeOf("number");
      expect(entry!.errorTime!).toBeGreaterThan(0);
    });

    it("blocks retry before cooldown expires", async () => {
      rasterizeMock.mockResolvedValue(null);

      const fs = createMockFs();
      const view = createMockView();

      await requestPdfPreview(view, "bad.pdf", fs);
      expect(view.state.field(pdfPreviewField).get("bad.pdf")?.status).toBe("error");

      // Try again immediately — should be blocked by cooldown
      rasterizeMock.mockClear();
      await requestPdfPreview(view, "bad.pdf", fs);
      expect(rasterizeMock).not.toHaveBeenCalled();
    });

    it("allows retry after cooldown expires", async () => {
      rasterizeMock.mockResolvedValue(null);

      const fs = createMockFs();
      const view = createMockView();

      await requestPdfPreview(view, "bad.pdf", fs);
      expect(view.state.field(pdfPreviewField).get("bad.pdf")?.status).toBe("error");

      // Simulate cooldown expiry by dispatching an error entry with old timestamp
      view.dispatch({
        effects: pdfPreviewEffect.of({
          path: "bad.pdf",
          entry: { status: "error", errorTime: Date.now() - ERROR_COOLDOWN_MS - 1 },
        }),
      });

      // Now a retry should go through — clear mock to count only the retry call
      rasterizeMock.mockReset();
      const canvas = document.createElement("canvas");
      canvas.width = 10;
      canvas.height = 10;
      rasterizeMock.mockResolvedValue(canvas);

      await requestPdfPreview(view, "bad.pdf", fs);
      expect(rasterizeMock).toHaveBeenCalledTimes(1);
      expect(view.state.field(pdfPreviewField).get("bad.pdf")?.status).toBe("ready");
    });

    it("records errorTime on catch-path errors", async () => {
      rasterizeMock.mockRejectedValue(new Error("network failure"));

      const fs = createMockFs();
      const view = createMockView();

      await requestPdfPreview(view, "net-fail.pdf", fs);

      const entry = view.state.field(pdfPreviewField).get("net-fail.pdf");
      expect(entry?.status).toBe("error");
      expect(entry?.errorTime).toBeTypeOf("number");
    });
  });

  describe("deduplication", () => {
    it("skips when status is 'loading'", async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 10;
      canvas.height = 10;
      rasterizeMock.mockResolvedValue(canvas);

      const fs = createMockFs();
      const view = createMockView();

      // Manually set loading state
      view.dispatch({
        effects: pdfPreviewEffect.of({
          path: "loading.pdf",
          entry: { status: "loading" },
        }),
      });

      await requestPdfPreview(view, "loading.pdf", fs);
      // Should not have called rasterize because status is loading
      expect(rasterizeMock).not.toHaveBeenCalled();
    });

    it("skips when ready AND canvas is present", async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 10;
      canvas.height = 10;
      rasterizeMock.mockResolvedValue(canvas);

      const fs = createMockFs();
      const view = createMockView();

      // First request
      await requestPdfPreview(view, "ok.pdf", fs);
      expect(view.state.field(pdfPreviewField).get("ok.pdf")?.status).toBe("ready");

      // Second request should be a no-op
      rasterizeMock.mockClear();
      await requestPdfPreview(view, "ok.pdf", fs);
      expect(rasterizeMock).not.toHaveBeenCalled();
    });
  });
});
