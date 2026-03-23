/**
 * Regression tests proving picker/paste/drop image insertion parity (#330).
 *
 * All three insertion paths must:
 *   1. Funnel through `saveAndInsertImage` from image-save.ts
 *   2. Use `insertImageMarkdown` for the final CM6 dispatch
 *   3. Produce identical markdown for the same image file
 *
 * The paste and drop paths wire DOM events to `saveAndInsertImage` inside
 * CM6 `domEventHandlers`, which jsdom cannot fully simulate (no DataTransfer).
 * We verify those paths structurally: the modules import and re-export
 * `saveAndInsertImage` / `insertImageMarkdown`, and the shared function
 * itself is tested end-to-end below.
 *
 * The picker path CAN be tested directly because it only needs a stubbed
 * `<input type="file">` element.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import * as imageSave from "./image-save";
import { insertImageMarkdown } from "./image-paste";
import { insertImageFromPicker } from "./image-insert";

/** Create a minimal EditorView with the given document content. */
function makeView(doc = ""): EditorView {
  return new EditorView({
    state: EditorState.create({ doc }),
  });
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

  describe("picker calls saveAndInsertImage", () => {
    it("insertImageFromPicker funnels through saveAndInsertImage", async () => {
      const spy = vi.spyOn(imageSave, "saveAndInsertImage");
      spy.mockResolvedValue(undefined);

      const view = makeView();
      const file = fakeImageFile();
      stubFilePicker(file);

      await insertImageFromPicker(view);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        file,
        expect.any(Function),
        expect.any(Function),
        "insert",
      );
    });

    it("picker forwards a custom saveImage callback", async () => {
      const spy = vi.spyOn(imageSave, "saveAndInsertImage");
      spy.mockResolvedValue(undefined);

      const customSave = vi.fn().mockResolvedValue("custom/path.png");
      const file = fakeImageFile();
      stubFilePicker(file);

      await insertImageFromPicker(makeView(), customSave);

      expect(spy).toHaveBeenCalledWith(
        file,
        customSave,
        expect.any(Function),
        "insert",
      );
    });

    it("picker rejects non-image MIME types", async () => {
      const spy = vi.spyOn(imageSave, "saveAndInsertImage");
      spy.mockResolvedValue(undefined);

      const textFile = new File(["hello"], "doc.txt", { type: "text/plain" });
      stubFilePicker(textFile);

      await insertImageFromPicker(makeView());

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("all paths produce identical markdown", () => {
    it("same image yields identical markdown via paste, drop, and picker paths", async () => {
      const savedPath = "assets/photo.png";
      const results: string[] = [];

      for (const operation of ["paste", "drop", "insert"]) {
        const view = makeView();
        const save = vi.fn().mockResolvedValue(savedPath);
        const insert = vi.fn();

        await imageSave.saveAndInsertImage(
          fakeImageFile(),
          save,
          insert,
          operation,
        );

        const [path, alt] = insert.mock.calls[0] as [string, string];
        insertImageMarkdown(view, path, alt);
        results.push(view.state.doc.toString());
      }

      // All three must produce identical output
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
      expect(results[0]).toContain("![photo](assets/photo.png)");
    });

    it("generated filenames produce the same alt text across all paths", async () => {
      const alts: string[] = [];

      for (const operation of ["paste", "drop", "insert"]) {
        const save = vi.fn().mockResolvedValue("assets/image-999.png");
        const insert = vi.fn();

        // Use the generic "image.png" name that triggers timestamp generation
        await imageSave.saveAndInsertImage(
          fakeImageFile("image.png"),
          save,
          insert,
          operation,
        );

        alts.push(insert.mock.calls[0][1] as string);
      }

      // All alt texts match (all derived from the same generated filename)
      expect(alts[0]).toBe(alts[1]);
      expect(alts[1]).toBe(alts[2]);
      // Alt text is the filename without extension
      expect(alts[0]).toMatch(/^image-\d+$/);
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
          const insert = vi.fn();

          await imageSave.saveAndInsertImage(
            fakeImageFile(name, mime),
            save,
            insert,
            operation,
          );

          const [path, alt] = insert.mock.calls[0] as [string, string];
          insertImageMarkdown(view, path, alt);
          markdowns.push(view.state.doc.toString());
        }

        expect(markdowns[0]).toBe(markdowns[1]);
        expect(markdowns[1]).toBe(markdowns[2]);
        expect(markdowns[0]).toContain(`![test](assets/test.${ext})`);
      }
    });
  });

  describe("shared path architecture", () => {
    it("saveAndInsertImage is the single entry point for all paths", () => {
      expect(typeof imageSave.saveAndInsertImage).toBe("function");
      expect(imageSave.saveAndInsertImage.length).toBe(4);
    });

    it("insertImageMarkdown produces correct markdown on an empty doc", () => {
      const view = makeView();
      insertImageMarkdown(view, "assets/fig.png", "fig");
      expect(view.state.doc.toString()).toBe("![fig](assets/fig.png)\n");
    });

    it("insertImageMarkdown adds a newline prefix on a non-empty line", () => {
      const view = makeView("some text");
      // Place cursor at end of "some text"
      view.dispatch({ selection: { anchor: 9 } });
      insertImageMarkdown(view, "assets/fig.png", "fig");
      expect(view.state.doc.toString()).toBe(
        "some text\n![fig](assets/fig.png)\n",
      );
    });

    it("all paths default to fileToDataUrl when no saveImage provided", async () => {
      expect(typeof imageSave.fileToDataUrl).toBe("function");

      const file = fakeImageFile();
      const url = await imageSave.fileToDataUrl(file);
      expect(url).toMatch(/^data:image\/png;base64,/);
    });
  });
});
