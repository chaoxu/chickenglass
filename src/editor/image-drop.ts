/**
 * Drag-and-drop image insertion for CodeMirror 6.
 *
 * When the user drags an image file onto the editor:
 * - The drop position is computed from the mouse coordinates.
 * - The `saveImage` callback saves/converts the file.
 * - A `![alt](path)` snippet is inserted at the drop position.
 *
 * Usage:
 *   ```ts
 *   import { imageDropExtension } from "../editor/image-drop";
 *
 *   createEditor({
 *     extensions: [imageDropExtension({ saveImage })],
 *   });
 *   ```
 */

import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  isImageMime,
  IMAGE_MIME_EXT,
  fileToDataUrl,
  generateImageFilename,
  altTextFromFilename,
  logImageError,
} from "./image-save";
import { insertImageMarkdown } from "./image-paste";

/**
 * Configuration for the image-drop extension.
 */
export interface ImageDropConfig {
  /**
   * Save an image and return the path (relative or data URL) to embed.
   *
   * @param file  The `File` object from the drag event.
   * @returns     A promise resolving to the path string used in the markdown.
   *
   * The default implementation converts the image to a data URL.
   */
  saveImage?: (file: File) => Promise<string>;
}

/**
 * Create a CM6 extension that handles image file drops onto the editor.
 *
 * Intercepts `drop` events, checks for image files, saves them via the
 * provided callback, and inserts markdown at the drop position.
 */
export function imageDropExtension(config: ImageDropConfig = {}): Extension {
  const save = config.saveImage ?? fileToDataUrl;

  return EditorView.domEventHandlers({
    dragover(event) {
      // Check if the drag contains files (we can't inspect types until drop)
      if (event.dataTransfer && event.dataTransfer.types.includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        return true;
      }
      return false;
    },

    drop(event, view) {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || dataTransfer.files.length === 0) return false;

      // Find the first image file
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const file = dataTransfer.files[i];
        if (!isImageMime(file.type)) continue;

        // We found an image — prevent default and handle it
        event.preventDefault();

        const ext = IMAGE_MIME_EXT[file.type] ?? "png";
        const baseName = generateImageFilename(file, ext);

        // Compute the drop position from mouse coordinates
        const dropPos = view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });

        // Move cursor to drop position first
        if (dropPos !== null) {
          view.dispatch({
            selection: { anchor: dropPos },
          });
        }

        // Save and insert asynchronously
        save(file)
          .then((path) => {
            insertImageMarkdown(view, path, altTextFromFilename(baseName));
          })
          .catch((err: unknown) => {
            logImageError("drop", err);
          });

        // Only handle the first image
        return true;
      }

      return false;
    },
  });
}
