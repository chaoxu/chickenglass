import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { FileSystem } from "../lib/types";
import { imageUrlField, imageUrlEffect, _resetImageUrlCache } from "./image-url-cache";
import { pdfPreviewField, pdfPreviewEffect, _resetPendingPaths } from "./pdf-preview-cache";
import { documentPathFacet, fileSystemFacet } from "../lib/types";

// Mock the rasterizer so PDF requests don't need a real PDF engine.
const { rasterizeMock } = vi.hoisted(() => ({
  rasterizeMock: vi.fn(),
}));
vi.mock("./pdf-rasterizer", () => ({
  rasterizePdfPage1: rasterizeMock,
}));

import { resolveLocalMediaPreview } from "./media-preview";

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
    readFileBinary: vi.fn().mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
  };
}

function createMockView(fs?: FileSystem) {
  let state = EditorState.create({
    doc: "",
    extensions: [
      imageUrlField,
      pdfPreviewField,
      documentPathFacet.of("posts/math.md"),
      ...(fs ? [fileSystemFacet.of(fs)] : []),
    ],
  });

  const view = {
    get state() {
      return state;
    },
    dispatch(tr: { effects?: unknown }) {
      state = state.update(tr as Parameters<EditorState["update"]>[0]).state;
    },
    dom: { isConnected: true },
  };

  return view as unknown as import("@codemirror/view").EditorView;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("resolveLocalMediaPreview", () => {
  beforeEach(() => {
    _resetImageUrlCache();
    _resetPendingPaths();
    rasterizeMock.mockReset();
  });

  describe("dispatch classification", () => {
    it("returns null for absolute https URLs", () => {
      const view = createMockView();
      expect(resolveLocalMediaPreview(view, "https://example.com/img.png")).toBeNull();
    });

    it("returns null for data URIs", () => {
      const view = createMockView();
      expect(resolveLocalMediaPreview(view, "data:image/png;base64,ABC")).toBeNull();
    });

    it("returns a loading result for a fresh relative image", () => {
      const view = createMockView(createMockFs());
      const result = resolveLocalMediaPreview(view, "diagram.png");
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("loading");
      expect(result!.resolvedPath).toBe("posts/diagram.png");
      if (result!.kind === "loading") expect(result!.isPdf).toBe(false);
    });

    it("returns a loading result for a fresh relative PDF", () => {
      const view = createMockView(createMockFs());
      const result = resolveLocalMediaPreview(view, "diagram.pdf");
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("loading");
      expect(result!.resolvedPath).toBe("posts/diagram.pdf");
      if (result!.kind === "loading") expect(result!.isPdf).toBe(true);
    });
  });

  describe("image cache states", () => {
    it("returns 'image' when cache has a ready entry with data URL", async () => {
      const fs = createMockFs();
      const view = createMockView(fs);

      // Load an image into the cache through the real flow
      const { requestImageDataUrl } = await import("./image-url-cache");
      await requestImageDataUrl(view, "posts/diagram.png", fs);

      const result = resolveLocalMediaPreview(view, "diagram.png");
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("image");
      expect(result!.resolvedPath).toBe("posts/diagram.png");
      if (result!.kind === "image") {
        expect(result!.dataUrl).toContain("data:image/png;base64,");
      }
    });

    it("returns 'error' for an errored image entry", () => {
      const view = createMockView();

      // Manually set error state
      view.dispatch({
        effects: imageUrlEffect.of({
          path: "posts/broken.png",
          entry: { status: "error" },
        }),
      });

      const result = resolveLocalMediaPreview(view, "broken.png");
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("error");
      if (result!.kind === "error") {
        expect(result!.fallbackSrc).toBe("broken.png");
      }
    });
  });

  describe("PDF cache states", () => {
    it("returns 'error' for an errored PDF entry", () => {
      const view = createMockView(createMockFs());

      view.dispatch({
        effects: pdfPreviewEffect.of({
          path: "posts/broken.pdf",
          entry: { status: "error", errorTime: Date.now() },
        }),
      });

      const result = resolveLocalMediaPreview(view, "broken.pdf");
      expect(result).not.toBeNull();
      expect(result!.kind).toBe("error");
      if (result!.kind === "error") {
        expect(result!.fallbackSrc).toBe("broken.pdf");
      }
    });
  });

  describe("path resolution", () => {
    it("resolves paths relative to the document", () => {
      const view = createMockView(createMockFs());
      const result = resolveLocalMediaPreview(view, "../assets/fig.png");
      expect(result).not.toBeNull();
      expect(result!.resolvedPath).toBe("assets/fig.png");
    });

    it("produces distinct paths for same filename from different documents", () => {
      const fs = createMockFs();

      // Document in posts/
      let state1 = EditorState.create({
        doc: "",
        extensions: [
          imageUrlField,
          pdfPreviewField,
          documentPathFacet.of("posts/math.md"),
          fileSystemFacet.of(fs),
        ],
      });
      const view1 = {
        get state() { return state1; },
        dispatch(tr: { effects?: unknown }) {
          state1 = state1.update(tr as Parameters<EditorState["update"]>[0]).state;
        },
        dom: { isConnected: true },
      } as unknown as import("@codemirror/view").EditorView;

      // Document in notes/
      let state2 = EditorState.create({
        doc: "",
        extensions: [
          imageUrlField,
          pdfPreviewField,
          documentPathFacet.of("notes/physics.md"),
          fileSystemFacet.of(fs),
        ],
      });
      const view2 = {
        get state() { return state2; },
        dispatch(tr: { effects?: unknown }) {
          state2 = state2.update(tr as Parameters<EditorState["update"]>[0]).state;
        },
        dom: { isConnected: true },
      } as unknown as import("@codemirror/view").EditorView;

      const r1 = resolveLocalMediaPreview(view1, "diagram.png");
      const r2 = resolveLocalMediaPreview(view2, "diagram.png");

      expect(r1!.resolvedPath).toBe("posts/diagram.png");
      expect(r2!.resolvedPath).toBe("notes/diagram.png");
    });
  });
});
