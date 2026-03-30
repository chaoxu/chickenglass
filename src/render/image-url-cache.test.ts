import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { FileSystem } from "../lib/types";
import {
  _resetImageUrlCache,
  getImageDataUrl,
  imageUrlEffect,
  imageUrlField,
  requestImageDataUrl,
} from "./image-url-cache";

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

function createMockView() {
  let state = EditorState.create({
    doc: "",
    extensions: [imageUrlField],
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

describe("requestImageDataUrl", () => {
  beforeEach(() => {
    _resetImageUrlCache();
  });

  it("loads a local image into the module cache and marks the field ready", async () => {
    const fs = createMockFs();
    const view = createMockView();

    await requestImageDataUrl(view, "posts/diagram.png", fs);

    expect((fs.readFileBinary as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("posts/diagram.png");
    expect(view.state.field(imageUrlField).get("posts/diagram.png")).toEqual({ status: "ready" });
    expect(getImageDataUrl("posts/diagram.png")).toBe("data:image/png;base64,iVBORw==");
  });

  it("does not re-read when a ready entry still has its cached data URL", async () => {
    const fs = createMockFs();
    const view = createMockView();

    await requestImageDataUrl(view, "posts/diagram.png", fs);
    (fs.readFileBinary as ReturnType<typeof vi.fn>).mockClear();

    await requestImageDataUrl(view, "posts/diagram.png", fs);

    expect(fs.readFileBinary).not.toHaveBeenCalled();
  });

  it("re-reads when the ready state outlives the module cache", async () => {
    const fs = createMockFs();
    const view = createMockView();

    await requestImageDataUrl(view, "posts/diagram.png", fs);
    expect(view.state.field(imageUrlField).get("posts/diagram.png")).toEqual({ status: "ready" });

    _resetImageUrlCache();
    view.dispatch({
      effects: imageUrlEffect.of({
        path: "posts/diagram.png",
        entry: { status: "ready" },
      }),
    });

    (fs.readFileBinary as ReturnType<typeof vi.fn>).mockClear();
    await requestImageDataUrl(view, "posts/diagram.png", fs);

    expect(fs.readFileBinary).toHaveBeenCalledTimes(1);
    expect(getImageDataUrl("posts/diagram.png")).toBe("data:image/png;base64,iVBORw==");
  });

  it("marks the entry as error when the path has no image extension", async () => {
    const fs = createMockFs();
    const view = createMockView();

    await requestImageDataUrl(view, "posts/diagram", fs);

    const entry = view.state.field(imageUrlField).get("posts/diagram");
    expect(entry).toEqual({ status: "error", errorTime: expect.any(Number) });
    expect(fs.readFileBinary).not.toHaveBeenCalled();
  });
});
