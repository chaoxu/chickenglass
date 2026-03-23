/**
 * Insert Image command — opens a file picker and inserts the chosen image.
 *
 * Uses the browser file input in both browser and Tauri mode so all insertion
 * paths flow through the same `saveImage` callback and image-path resolution.
 */

import type { EditorView } from "@codemirror/view";
import {
  isImageMime,
  IMAGE_EXTENSIONS,
  fileToDataUrl,
  logImageError,
  saveAndInsertImage,
} from "./image-save";
import { insertImageMarkdown } from "./image-paste";
import { IMAGE_TIMEOUT_MS } from "../constants";

/**
 * Open a file picker and insert the selected image into the editor.
 *
 * @param view       The CM6 EditorView to insert into.
 * @param saveImage  Callback that saves/converts the image and returns the
 *                   path to use in the markdown. Falls back to data URL.
 */
export async function insertImageFromPicker(
  view: EditorView,
  saveImage?: (file: File) => Promise<string>,
): Promise<void> {
  const save = saveImage ?? fileToDataUrl;

  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",") + ",image/*";
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve();
        return;
      }

      if (!isImageMime(file.type)) {
        logImageError("insert", `unsupported MIME type: ${file.type}`);
        resolve();
        return;
      }

      void saveAndInsertImage(
        file,
        save,
        (path, alt) => {
          insertImageMarkdown(view, path, alt);
          view.focus();
        },
        "insert",
      ).then(resolve).catch((e: unknown) => {
        logImageError("insert", `saveAndInsertImage failed: ${e instanceof Error ? e.message : String(e)}`);
        resolve();
      });
    });

    // Handle cancel (user closes the dialog without selecting)
    input.addEventListener("cancel", () => {
      resolve();
    });

    document.body.appendChild(input);
    input.click();
    // Clean up the input element after a delay
    setTimeout(() => {
      input.remove();
    }, IMAGE_TIMEOUT_MS);
  });
}
