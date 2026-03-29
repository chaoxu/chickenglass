/**
 * Image paste from clipboard.
 *
 * When the user pastes (Cmd+V / Ctrl+V) while the editor is focused and the
 * clipboard contains an image:
 *
 *   1. Save the image to `assets/<timestamp>.<ext>` via the provided `saveImage`
 *      callback.  In browser / demo mode the callback receives a data URL;
 *      in Tauri mode it can write the bytes to disk.
 *   2. Insert `![alt](path)` at the current cursor position.
 *
 * Usage:
 *   ```ts
 *   import { imagePasteExtension } from "../editor/image-paste";
 *
 *   createEditor({
 *     extensions: [imagePasteExtension()],
 *   });
 *   ```
 */

import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  IMAGE_MIME_EXT,
  createImageHandler,
  type ImageSaveConfig,
} from "./image-save";

// Re-export for backwards compatibility
export { escapeMarkdownPath, insertImageMarkdown } from "./image-save";

/**
 * Configuration for the image-paste extension.
 * @see ImageSaveConfig
 */
export type ImagePasteConfig = ImageSaveConfig;

/**
 * Create a CM6 extension that intercepts paste events containing images.
 *
 * When an image is found in the clipboard, `saveImage` is called with the
 * `File` object and the returned path is used in the inserted markdown.
 * The default `saveImage` embeds the image as a data URL (browser-safe).
 */
export function imagePasteExtension(config: ImagePasteConfig = {}): Extension {
  const handle = createImageHandler(config);

  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;

      // Check for image items in the clipboard
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (!(item.type in IMAGE_MIME_EXT)) continue;

        const file = item.getAsFile();
        if (!file) continue;

        // Prevent the default paste (which would paste nothing or garbled text)
        event.preventDefault();

        handle(view, file, "paste");

        // Only handle the first image item
        return true;
      }

      return false;
    },
  });
}
