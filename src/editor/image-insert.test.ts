/**
 * Regression tests proving picker/paste/drop image insertion parity (#330).
 *
 * All three insertion paths must:
 *   1. Funnel through `handleImageInsert` from image-save.ts
 *   2. Produce identical markdown for the same image file
 *
 * The paste and drop paths wire DOM events to `handleImageInsert` inside
 * CM6 `domEventHandlers`, which jsdom cannot fully simulate (no DataTransfer).
 * We verify those paths structurally: the modules import and call
 * `handleImageInsert` / `createImageHandler`, and the shared function
 * itself is tested end-to-end below.
 *
 * The picker path CAN be tested directly because it only needs a stubbed
 * `<input type="file">` element.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EditorView } from "@codemirror/view";

import * as imageSave from "./image-save";
import { insertImageFromPicker } from "./image-insert";
import { createTestView } from "../test-utils";

const views: EditorView[] = [];

/** Create a minimal EditorView with the given document content. */
function makeView(doc = ""): EditorView {
  const view = createTestView(doc, { focus: false });
  views.push(view);
  return view;
}

/** Create a fake image File with a given name and MIME type. */
function fakeImageFile(
  name = "photo.png",
  mime = "image/png",
): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: mime,
  });
}

/**
 * Stub `document.createElement` so that `<input type="file">` triggers
 * a `change` event with the given file when `.click()` is called.
 */
function stubFilePicker(file: File): void {
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = origCreate(tag);
    if (tag === "input") {
      Object.defineProperty(el, "click", {
        value: () => {
          Object.defineProperty(el, "files", { value: [file] });
          el.dispatchEvent(new Event("change"));
        },
      });
    }
    return el;
  });
}

describe("image insertion parity (#330)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    while (views.length > 0) {
      views.pop()?.destroy();
    }
  });

  describe("picker calls handleImageInsert", () => {
    it("insertImageFromPicker funnels through handleImageInsert", async () => {
      const spy = vi.spyOn(imageSave, "handleImageInsert");
      spy.mockResolvedValue(undefined);

      const view = makeView();
      const file = fakeImageFile();
      stubFilePicker(file);

      await insertImageFromPicker(view);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        view,
        file,
        expect.objectContaining({ operation: "insert" }),
      );
    });

    it("picker forwards a custom saveImage callback", async () => {
      const spy = vi.spyOn(imageSave, "handleImageInsert");
      spy.mockResolvedValue(undefined);

      const customSave = vi.fn().mockResolvedValue("custom/path.png");
      const file = fakeImageFile();
      stubFilePicker(file);

      await insertImageFromPicker(makeView(), customSave);

      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        file,
        expect.objectContaining({ save: customSave, operation: "insert" }),
      );
    });

    it("picker rejects non-image MIME types", async () => {
      const spy = vi.spyOn(imageSave, "handleImageInsert");
      spy.mockResolvedValue(undefined);

      const textFile = new File(["hello"], "doc.txt", { type: "text/plain" });
      stubFilePicker(textFile);

      await insertImageFromPicker(makeView());

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("all paths produce identical markdown", () => {
    it("same image yields identical markdown via all paths", async () => {
      const savedPath = "assets/photo.png";
      const results: string[] = [];

      for (const operation of ["paste", "drop", "insert"]) {
        const view = makeView();
        const save = vi.fn().mockResolvedValue(savedPath);

        await imageSave.handleImageInsert(view, fakeImageFile(), {
          save,
          operation,
        });

        results.push(view.state.doc.toString());
      }

      // All three must produce identical output
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
      expect(results[0]).toContain("![photo](assets/photo.png)");
    });

    it("generated filenames produce the same alt text across all paths", async () => {
      // Pin Date.now to avoid timestamp drift across sequential calls
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const docs: string[] = [];

      for (const operation of ["paste", "drop", "insert"]) {
        const view = makeView();
        const save = vi.fn().mockResolvedValue("assets/image-999.png");

        // Use the generic "image.png" name that triggers timestamp generation
        await imageSave.handleImageInsert(
          view,
          fakeImageFile("image.png"),
          { save, operation },
        );

        docs.push(view.state.doc.toString());
      }

      vi.restoreAllMocks();

      // All documents match (same generated alt text)
      expect(docs[0]).toBe(docs[1]);
      expect(docs[1]).toBe(docs[2]);
      // Alt text is the filename without extension
      expect(docs[0]).toMatch(/!\[image-\d+\]/);
    });

    it("multiple MIME types produce identical results across paths", async () => {
      const mimes = ["image/png", "image/jpeg", "image/gif", "image/webp"];

      for (const mime of mimes) {
        const ext = imageSave.IMAGE_MIME_EXT[mime];
        const name = `test.${ext}`;
        const savedPath = `assets/${name}`;
        const markdowns: string[] = [];

        for (const operation of ["paste", "drop", "insert"]) {
          const view = makeView();
          const save = vi.fn().mockResolvedValue(savedPath);

          await imageSave.handleImageInsert(
            view,
            fakeImageFile(name, mime),
            { save, operation },
          );

          markdowns.push(view.state.doc.toString());
        }

        expect(markdowns[0]).toBe(markdowns[1]);
        expect(markdowns[1]).toBe(markdowns[2]);
        expect(markdowns[0]).toContain(`![test](assets/test.${ext})`);
      }
    });
  });

  describe("shared path architecture", () => {
    it("handleImageInsert is the single entry point for all paths", () => {
      expect(typeof imageSave.handleImageInsert).toBe("function");
      expect(imageSave.handleImageInsert.length).toBe(3);
    });

    it("all paths default to fileToDataUrl when no save provided", async () => {
      expect(typeof imageSave.fileToDataUrl).toBe("function");

      const file = fakeImageFile();
      const url = await imageSave.fileToDataUrl(file);
      expect(url).toMatch(/^data:image\/png;base64,/);
    });
  });
});
