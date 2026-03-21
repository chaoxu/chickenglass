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
  fileToDataUrl,
  generateImageFilename,
  altTextFromFilename,
  logImageError,
} from "./image-save";

// Re-export for backwards compatibility
export { fileToDataUrl } from "./image-save";

/**
 * Configuration for the image-paste extension.
 */
export interface ImagePasteConfig {
  /**
   * Save an image and return the path (relative or data URL) to embed.
   *
   * @param file  The `File` object from the clipboard.
   * @returns     A promise resolving to the path string used in the markdown.
   *
   * The default implementation converts the image to a data URL, which works
   * in browser / demo mode without any filesystem access.
   */
  saveImage?: (file: File) => Promise<string>;
}

/**
 * Insert an image markdown snippet at the given position.
 *
 * @param view  The editor view.
 * @param path  The image path or data URL.
 * @param alt   The alt text.
 * @param pos   The document position to insert at. Defaults to the current
 *              cursor position. Pass an explicit value when the insertion
 *              happens asynchronously (e.g. after a drag-and-drop save)
 *              to avoid using a stale cursor position.
 *
 * Inserts on its own line when the target position is not already on an
 * empty line.
 */
export function insertImageMarkdown(
  view: EditorView,
  path: string,
  alt: string,
  pos?: number,
): void {
  // When an explicit position is given (e.g. drop), insert there with no
  // selection replacement. When using the current selection (e.g. paste),
  // replace the selected range so pasting over a selection works naturally.
  const sel = view.state.selection.main;
  const insertFrom = pos ?? sel.from;
  const insertTo = pos !== undefined ? pos : sel.to;
  const line = view.state.doc.lineAt(insertFrom);
  const prefix = line.text.trim() === "" && insertFrom === line.from ? "" : "\n";
  const snippet = `${prefix}![${alt}](${path})\n`;
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: snippet },
    selection: { anchor: insertFrom + snippet.length },
  });
  view.focus();
}

/**
 * Create a CM6 extension that intercepts paste events containing images.
 *
 * When an image is found in the clipboard, `saveImage` is called with the
 * `File` object and the returned path is used in the inserted markdown.
 * The default `saveImage` embeds the image as a data URL (browser-safe).
 */
export function imagePasteExtension(config: ImagePasteConfig = {}): Extension {
  const save = config.saveImage ?? fileToDataUrl;

  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;

      // Check for image items in the clipboard
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        const ext = IMAGE_MIME_EXT[item.type];
        if (!ext) continue;

        const file = item.getAsFile();
        if (!file) continue;

        // Prevent the default paste (which would paste nothing or garbled text)
        event.preventDefault();

        const baseName = generateImageFilename(file, ext);

        // Save and insert asynchronously
        save(file)
          .then((path) => {
            insertImageMarkdown(view, path, altTextFromFilename(baseName));
          })
          .catch((err: unknown) => {
            logImageError("paste", err);
          });

        // Only handle the first image item
        return true;
      }

      return false;
    },
  });
}
