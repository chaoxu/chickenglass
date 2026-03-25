import { describe, expect, it, vi, beforeEach } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  pdfPreviewField,
  pdfPreviewEffect,
  loadPdfPreview,
  requestPdfPreview,
  _resetPendingPaths,
  type PdfPreviewEntry,
} from "./pdf-preview-cache";
import type { FileSystem } from "../lib/types";

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("./pdf-rasterizer", () => ({
  rasterizePdfPage1: vi.fn(),
}));

import { rasterizePdfPage1 } from "./pdf-rasterizer";

const mockRasterize = vi.mocked(rasterizePdfPage1);

/** Default PDF magic bytes for the mock. */
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/**
 * Create a FileSystem mock. Only readFileBinary is configured with behavior;
 * the rest satisfy the interface type.
 */
function createMockFs(
  readResultOrFn: Uint8Array | Error | ReturnType<typeof vi.fn> = PDF_MAGIC,
): { fs: FileSystem; readFileBinary: ReturnType<typeof vi.fn> } {
  const readFileBinary =
    typeof readResultOrFn === "function"
      ? readResultOrFn
      : vi.fn().mockImplementation(async () => {
          if (readResultOrFn instanceof Error) throw readResultOrFn;
          return readResultOrFn;
        });

  const fs = {
    listTree: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createFile: vi.fn(),
    exists: vi.fn(),
    renameFile: vi.fn(),
    createDirectory: vi.fn(),
    deleteFile: vi.fn(),
    writeFileBinary: vi.fn(),
    readFileBinary,
  } as unknown as FileSystem;

  return { fs, readFileBinary };
}

/** Create an EditorState with the pdfPreviewField installed. */
function createState(): EditorState {
  return EditorState.create({
    doc: "",
    extensions: [pdfPreviewField],
  });
}

/** Read the cache from a state. */
function getCache(
  state: EditorState,
): ReadonlyMap<string, PdfPreviewEntry> {
  return state.field(pdfPreviewField);
}

/** Create a minimal mock EditorView for requestPdfPreview. */
function createMockView(state?: EditorState) {
  const s = state ?? createState();
  let currentState = s;

  const mock = {
    get state() {
      return currentState;
    },
    dom: { isConnected: true },
    dispatch: vi.fn().mockImplementation((spec: TransactionSpec) => {
      const tr = currentState.update(spec);
      currentState = tr.state;
    }),
  };
  return mock as typeof mock & EditorView;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pdfPreviewField", () => {
  describe("StateField basics", () => {
    it("starts with an empty map", () => {
      const state = createState();
      const cache = getCache(state);
      expect(cache.size).toBe(0);
    });

    it("adds a loading entry via effect", () => {
      const state = createState();
      const newState = state.update({
        effects: pdfPreviewEffect.of({
          path: "fig/test.pdf",
          entry: { status: "loading" },
        }),
      }).state;

      const cache = getCache(newState);
      expect(cache.get("fig/test.pdf")).toEqual({ status: "loading" });
    });

    it("transitions from loading to ready", () => {
      let state = createState();

      state = state.update({
        effects: pdfPreviewEffect.of({
          path: "a.pdf",
          entry: { status: "loading" },
        }),
      }).state;

      state = state.update({
        effects: pdfPreviewEffect.of({
          path: "a.pdf",
          entry: { status: "ready", dataUrl: "data:image/png;base64,AAA" },
        }),
      }).state;

      const entry = getCache(state).get("a.pdf");
      expect(entry).toEqual({
        status: "ready",
        dataUrl: "data:image/png;base64,AAA",
      });
    });

    it("transitions from loading to error", () => {
      let state = createState();

      state = state.update({
        effects: pdfPreviewEffect.of({
          path: "bad.pdf",
          entry: { status: "loading" },
        }),
      }).state;

      state = state.update({
        effects: pdfPreviewEffect.of({
          path: "bad.pdf",
          entry: { status: "error" },
        }),
      }).state;

      expect(getCache(state).get("bad.pdf")).toEqual({ status: "error" });
    });

    it("preserves other entries when updating one", () => {
      let state = createState();

      state = state.update({
        effects: pdfPreviewEffect.of({
          path: "a.pdf",
          entry: { status: "ready", dataUrl: "data:a" },
        }),
      }).state;

      state = state.update({
        effects: pdfPreviewEffect.of({
          path: "b.pdf",
          entry: { status: "loading" },
        }),
      }).state;

      const cache = getCache(state);
      expect(cache.size).toBe(2);
      expect(cache.get("a.pdf")?.status).toBe("ready");
      expect(cache.get("b.pdf")?.status).toBe("loading");
    });

    it("returns same reference when no effects apply", () => {
      const state = createState();
      const updated = state.update({ changes: [] }).state;
      // Same map identity -- no needless copy.
      expect(getCache(state)).toBe(getCache(updated));
    });

    it("applies multiple effects in a single transaction", () => {
      const state = createState();
      const newState = state.update({
        effects: [
          pdfPreviewEffect.of({
            path: "a.pdf",
            entry: { status: "loading" },
          }),
          pdfPreviewEffect.of({
            path: "b.pdf",
            entry: { status: "ready", dataUrl: "data:b" },
          }),
        ],
      }).state;

      const cache = getCache(newState);
      expect(cache.size).toBe(2);
      expect(cache.get("a.pdf")?.status).toBe("loading");
      expect(cache.get("b.pdf")?.status).toBe("ready");
    });
  });

  describe("loadPdfPreview", () => {
    beforeEach(() => {
      _resetPendingPaths();
      vi.clearAllMocks();
    });

    it("caches a successful rasterized preview across repeated calls", async () => {
      const { fs, readFileBinary } = createMockFs();
      mockRasterize.mockResolvedValueOnce("data:image/png;base64,CACHED");

      const first = await loadPdfPreview("fig/cached.pdf", fs);
      const second = await loadPdfPreview("fig/cached.pdf", fs);

      expect(first).toBe("data:image/png;base64,CACHED");
      expect(second).toBe("data:image/png;base64,CACHED");
      expect(readFileBinary).toHaveBeenCalledTimes(1);
      expect(mockRasterize).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent loads across callers", async () => {
      let resolveRead: (value: Uint8Array) => void;
      const customRead = vi.fn().mockImplementation(
        () => new Promise<Uint8Array>((resolve) => {
          resolveRead = resolve;
        }),
      );
      const { fs, readFileBinary } = createMockFs(customRead);
      mockRasterize.mockResolvedValue("data:image/png;base64,CONCURRENT");

      const p1 = loadPdfPreview("fig/concurrent.pdf", fs);
      const p2 = loadPdfPreview("fig/concurrent.pdf", fs);

      expect(readFileBinary).toHaveBeenCalledTimes(1);

      resolveRead!(PDF_MAGIC);
      await expect(Promise.all([p1, p2])).resolves.toEqual([
        "data:image/png;base64,CONCURRENT",
        "data:image/png;base64,CONCURRENT",
      ]);
      expect(mockRasterize).toHaveBeenCalledTimes(1);
    });

    it("does not cache failures, so later attempts can retry", async () => {
      const customRead = vi.fn()
        .mockRejectedValueOnce(new Error("missing"))
        .mockResolvedValueOnce(PDF_MAGIC);
      const { fs } = createMockFs(customRead);
      mockRasterize.mockResolvedValueOnce("data:image/png;base64,RECOVERED");

      const first = await loadPdfPreview("fig/missing.pdf", fs);
      const second = await loadPdfPreview("fig/missing.pdf", fs);

      expect(first).toBeNull();
      expect(second).toBe("data:image/png;base64,RECOVERED");
      expect(customRead).toHaveBeenCalledTimes(2);
      expect(mockRasterize).toHaveBeenCalledTimes(1);
    });
  });

  describe("requestPdfPreview", () => {
    beforeEach(() => {
      _resetPendingPaths();
      vi.clearAllMocks();
    });

    it("loads and caches a PDF preview on success", async () => {
      const { fs, readFileBinary } = createMockFs();
      mockRasterize.mockResolvedValueOnce("data:image/png;base64,OK");
      const view = createMockView();

      await requestPdfPreview(view, "fig/diagram.pdf", fs);

      expect(readFileBinary).toHaveBeenCalledWith("fig/diagram.pdf");
      expect(mockRasterize).toHaveBeenCalledWith(PDF_MAGIC);
      const entry = getCache(view.state).get("fig/diagram.pdf");
      expect(entry).toEqual({
        status: "ready",
        dataUrl: "data:image/png;base64,OK",
      });
    });

    it("dispatches error when rasterization returns empty string", async () => {
      const { fs } = createMockFs();
      mockRasterize.mockResolvedValueOnce("");
      const view = createMockView();

      await requestPdfPreview(view, "corrupt.pdf", fs);

      const entry = getCache(view.state).get("corrupt.pdf");
      expect(entry?.status).toBe("error");
    });

    it("dispatches error when readFileBinary throws", async () => {
      const { fs } = createMockFs(new Error("File not found"));
      const view = createMockView();

      await requestPdfPreview(view, "missing.pdf", fs);

      const entry = getCache(view.state).get("missing.pdf");
      expect(entry?.status).toBe("error");
      expect(mockRasterize).not.toHaveBeenCalled();
    });

    it("skips if path is already cached", async () => {
      const { fs, readFileBinary } = createMockFs();
      const state = createState();
      const preloaded = state.update({
        effects: pdfPreviewEffect.of({
          path: "cached.pdf",
          entry: { status: "ready", dataUrl: "data:cached" },
        }),
      }).state;
      const view = createMockView(preloaded);

      await requestPdfPreview(view, "cached.pdf", fs);

      expect(readFileBinary).not.toHaveBeenCalled();
    });

    it("skips if path is in error state (avoids retry storms)", async () => {
      const { fs, readFileBinary } = createMockFs();
      const state = createState();
      const errState = state.update({
        effects: pdfPreviewEffect.of({
          path: "bad.pdf",
          entry: { status: "error" },
        }),
      }).state;
      const view = createMockView(errState);

      await requestPdfPreview(view, "bad.pdf", fs);

      expect(readFileBinary).not.toHaveBeenCalled();
    });

    it("deduplicates via cache after loading dispatch", async () => {
      // Once the first requestPdfPreview dispatches "loading", the second
      // call sees the cached entry and returns immediately.
      const { fs, readFileBinary } = createMockFs();
      mockRasterize.mockResolvedValueOnce("data:dedup");
      const view = createMockView();

      await requestPdfPreview(view, "dup.pdf", fs);

      // Second request should be a no-op (cached as "ready")
      await requestPdfPreview(view, "dup.pdf", fs);

      expect(readFileBinary).toHaveBeenCalledTimes(1);
      expect(mockRasterize).toHaveBeenCalledTimes(1);
    });

    it("deduplicates via pendingPaths for truly concurrent requests", async () => {
      // When readFileBinary is slow, two synchronous calls race.
      // The first adds to pendingPaths before dispatching "loading",
      // and the second is blocked by pendingPaths.
      let resolveRead: (value: Uint8Array) => void;
      const customRead = vi.fn().mockImplementation(
        () =>
          new Promise<Uint8Array>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const { fs, readFileBinary } = createMockFs(customRead);

      mockRasterize.mockResolvedValue("data:concurrent");

      // Use a view where dispatch does NOT update state synchronously,
      // simulating the window before the "loading" effect is visible.
      const state = createState();
      const currentState = state;
      const view = {
        get state() {
          return currentState;
        },
        dom: { isConnected: true },
        // No-op dispatch: state stays empty so the second call cannot
        // see a cached entry. This isolates the pendingPaths guard.
        dispatch: vi.fn(),
      } as unknown as EditorView;

      const p1 = requestPdfPreview(view, "race.pdf", fs);
      const p2 = requestPdfPreview(view, "race.pdf", fs);

      // Only one readFileBinary call
      expect(readFileBinary).toHaveBeenCalledTimes(1);

      // Unblock the read so p1 can finish
      resolveRead!(PDF_MAGIC);
      await Promise.all([p1, p2]);

      expect(mockRasterize).toHaveBeenCalledTimes(1);
    });

    it("silently skips dispatch when view is disconnected", async () => {
      const { fs } = createMockFs();
      mockRasterize.mockResolvedValueOnce("data:ok");
      const view = createMockView();
      view.dom.isConnected = false;

      await requestPdfPreview(view, "detached.pdf", fs);

      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it("cleans up pendingPaths even on error", async () => {
      const { fs } = createMockFs(new Error("boom"));
      const view = createMockView();

      await requestPdfPreview(view, "cleanup.pdf", fs);

      // After the request completes (with error), the path should be cached
      // as error -- not stuck in pendingPaths.
      const entry = getCache(view.state).get("cleanup.pdf");
      expect(entry?.status).toBe("error");
    });
  });
});
