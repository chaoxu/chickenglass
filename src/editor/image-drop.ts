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
  fileToDataUrl,
  saveAndInsertImage,
  type ImageSaveConfig,
} from "./image-save";
import { insertImageMarkdown } from "./image-paste";

/**
 * Configuration for the image-drop extension.
 * @see ImageSaveConfig
 */
export type ImageDropConfig = ImageSaveConfig;

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

        // Capture the drop position from mouse coordinates synchronously.
        // We pass this explicitly to insertImageMarkdown rather than relying
        // on view.state.selection.main, which may have moved by the time the
        // async save resolves.
        const dropPos = view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });

        saveAndInsertImage(
          file,
          save,
          (path, alt) => insertImageMarkdown(view, path, alt, dropPos ?? undefined),
          "drop",
        );

        // Only handle the first image
        return true;
      }

      return false;
    },
  });
}
