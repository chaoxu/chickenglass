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

/** Supported image MIME types and their default file extensions. */
const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

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

/** Convert a File to a base-64 data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/**
 * Insert an image markdown snippet at the current cursor position.
 *
 * Inserts on its own line when the cursor is not already on an empty line.
 */
export function insertImageMarkdown(view: EditorView, path: string, alt: string): void {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = line.text.trim() === "" && from === line.from ? "" : "\n";
  const snippet = `${prefix}![${alt}](${path})\n`;
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: from + snippet.length },
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

        // Determine a filename: use the file's own name if non-empty, otherwise
        // generate one from the current timestamp.
        const baseName =
          file.name && file.name !== "image.png"
            ? file.name
            : `image-${Date.now()}.${ext}`;

        // Save and insert asynchronously
        save(file)
          .then((path) => {
            const alt = baseName.replace(/\.[^.]+$/, ""); // strip extension for alt text
            insertImageMarkdown(view, path, alt);
          })
          .catch((err: unknown) => {
            console.error("[chickenglass] image paste failed:", err);
          });

        // Only handle the first image item
        return true;
      }

      return false;
    },
  });
}
