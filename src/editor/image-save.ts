/**
 * Shared image-saving logic for paste, drag-and-drop, and file picker.
 *
 * In **Tauri mode** (with a filesystem), images are saved as files in the
 * configured image folder (from frontmatter `image-folder` or default `assets`)
 * and a relative path is returned.
 *
 * In **browser/demo mode** (no filesystem or MemoryFileSystem), images are
 * converted to data URLs and returned inline.
 */

import { EditorView } from "@codemirror/view";
import type { FileSystem } from "../lib/types";
import {
  relativeMarkdownReferencePathFromDocument,
  resolveMarkdownReferencePathFromDocument,
} from "../lib/markdown-reference-paths";
import { isTauri } from "../lib/tauri";

/** Supported image MIME types and their default file extensions. */
export const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

/** Deduplicated list of accepted image file extensions (for file dialogs). */
export const IMAGE_EXTENSIONS: string[] = [...new Set(Object.values(IMAGE_MIME_EXT))];

/** Check whether a MIME type is a supported image type. */
export function isImageMime(mime: string): boolean {
  return mime in IMAGE_MIME_EXT;
}

function sanitizeImageFilename(filename: string): string | null {
  const basename = filename.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  const cleaned = [...basename]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return null;
  }
  return cleaned;
}

/** Convert a File to a base-64 data URL. */
export async function fileToDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${file.type || "application/octet-stream"};base64,${base64}`;
}

/** Convert a File to a Uint8Array. */
async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Shared configuration for image-insert extensions (paste, drop, file picker).
 *
 * Used by `imagePasteExtension` and `imageDropExtension` so that both accept
 * the same shape and callers need not care which extension they configure.
 */
export interface ImageSaveConfig {
  /**
   * Save an image and return the path (relative or data URL) to embed.
   *
   * @param file  The `File` object from the clipboard or drag event.
   * @returns     A promise resolving to the path string used in the markdown.
   *
   * The default implementation converts the image to a data URL, which works
   * in browser / demo mode without any filesystem access.
   */
  saveImage?: (file: File) => Promise<string>;
}

/** Configuration for the image saver. */
export interface ImageSaveContext {
  /** The filesystem to write images to (if available). */
  fs?: FileSystem;
  /** Path of the currently edited document (for resolving relative paths). */
  docPath?: string;
  /** Image folder from frontmatter (e.g., "assets"). */
  imageFolder?: string;
}

/**
 * Generate a unique filename for an image.
 *
 * If the file already has a meaningful name (not the generic "image.png"),
 * use it. Otherwise generate a timestamped name.
 */
export function generateImageFilename(file: File, ext: string): string {
  const sanitizedName = sanitizeImageFilename(file.name);
  if (sanitizedName && sanitizedName !== "image.png" && sanitizedName !== "blob") {
    return sanitizedName;
  }
  return `image-${Date.now()}.${ext}`;
}

/**
 * Derive alt text from a filename by stripping the file extension.
 *
 * Examples:
 *   "my-diagram.png" → "my-diagram"
 *   "photo.jpeg"     → "photo"
 *   "noext"          → "noext"
 */
export function altTextFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/**
 * Log an image operation error with a consistent prefix.
 *
 * All image modules use this for uniform error reporting.
 */
export function logImageError(operation: string, err: unknown): void {
  console.error(`[coflat] image ${operation} failed:`, err);
}

/**
 * Escape a path for use inside a markdown image link `![alt](path)`.
 *
 * Markdown terminates the URL at the first unescaped `)`, so any literal
 * `)` in the path must be percent-encoded. Spaces are also encoded because
 * they would split the link in many parsers. Other characters are left as-is
 * to keep relative paths readable.
 */
export function escapeMarkdownPath(path: string): string {
  return path.replace(/ /g, "%20").replace(/\)/g, "%29");
}

/**
 * Deduplicate a filename by appending a numeric suffix if needed.
 *
 * Checks `<folder>/<name>` against the filesystem and returns a name
 * that does not collide.
 */
async function deduplicateFilename(
  fs: FileSystem,
  folder: string,
  filename: string,
): Promise<string> {
  const dotIdx = filename.lastIndexOf(".");
  const base = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx >= 0 ? filename.slice(dotIdx) : "";

  let candidate = filename;
  let counter = 1;
  while (await fs.exists(`${folder}/${candidate}`)) {
    candidate = `${base}-${counter}${ext}`;
    counter++;
  }
  return candidate;
}

export interface PlannedImageTarget {
  /** Project-relative path used for filesystem writes. */
  targetPath: string;
  /** Markdown path inserted into the document. */
  markdownPath: string;
}

/**
 * Allocate a unique image target path for a document.
 */
export async function planImageTarget(
  fs: FileSystem,
  docPath: string,
  imageFolder: string,
  rawFilename: string,
): Promise<PlannedImageTarget> {
  const targetDir = resolveMarkdownReferencePathFromDocument(docPath, imageFolder);

  if (targetDir) {
    try {
      const dirExists = await fs.exists(targetDir);
      if (!dirExists) {
        await fs.createDirectory(targetDir);
      }
    } catch (_error) {
      // best-effort: directory might already exist (race condition or implicit via file creation)
    }
  }

  const filename = targetDir
    ? await deduplicateFilename(fs, targetDir, rawFilename)
    : rawFilename;
  const targetPath = targetDir ? `${targetDir}/${filename}` : filename;

  return {
    targetPath,
    markdownPath: relativeMarkdownReferencePathFromDocument(docPath, targetPath),
  };
}

/**
 * Save an image file and return the path to use in markdown.
 *
 * - In Tauri mode with a filesystem: saves the binary data to the image
 *   folder and returns a relative path like `assets/image-1234.png`.
 * - In browser/demo mode: converts to a data URL.
 */
export async function saveImage(
  file: File,
  ctx: ImageSaveContext,
): Promise<string> {
  const ext = IMAGE_MIME_EXT[file.type];
  if (!ext) {
    throw new Error(`Unsupported image type: ${file.type}`);
  }

  // Determine whether we can save to the filesystem
  const fs = ctx.fs;
  const docPath = ctx.docPath;

  if (!fs || !docPath || !isTauri()) {
    // Browser/demo mode: return data URL
    return fileToDataUrl(file);
  }
  const imageFolder = ctx.imageFolder || "assets";

  // Generate a unique filename
  const rawFilename = generateImageFilename(file, ext);
  const target = await planImageTarget(fs, docPath, imageFolder, rawFilename);

  // Write the binary data
  const data = await fileToUint8Array(file);
  await fs.writeFileBinary(target.targetPath, data);

  // Return the path relative to the document for markdown insertion
  return target.markdownPath;
}

/**
 * Create a `saveImage` callback bound to a specific context.
 *
 * This is the function passed to `imagePasteExtension` and
 * `imageDropExtension` as the `saveImage` config option.
 */
export function createImageSaver(
  ctx: ImageSaveContext,
): (file: File) => Promise<string> {
  return (file: File) => saveImage(file, ctx);
}

/**
 * Insert an image markdown snippet at the given position.
 *
 * Inserts on its own line when the target position is not already on an
 * empty line.
 *
 * @param view  The editor view.
 * @param path  The image path or data URL.
 * @param alt   The alt text.
 * @param pos   The document position to insert at. Defaults to the current
 *              cursor position. Pass an explicit value when the insertion
 *              happens asynchronously (e.g. after a drag-and-drop save)
 *              to avoid using a stale cursor position.
 */
export function insertImageMarkdown(
  view: EditorView,
  path: string,
  alt: string,
  pos?: number,
): void {
  const sel = view.state.selection.main;
  const insertFrom = pos ?? sel.from;
  const insertTo = pos !== undefined ? pos : sel.to;
  const line = view.state.doc.lineAt(insertFrom);
  const prefix = line.text.trim() === "" && insertFrom === line.from ? "" : "\n";
  const safePath = escapeMarkdownPath(path);
  const snippet = `${prefix}![${alt}](${safePath})\n`;
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: snippet },
    selection: { anchor: insertFrom + snippet.length },
  });
  view.focus();
}

/**
 * Options for {@link handleImageInsert}.
 */
export interface HandleImageInsertOptions {
  /** Callback that persists the image and returns a path/URL. Defaults to data URL. */
  save?: (file: File) => Promise<string>;
  /** Explicit insert position. When omitted, the current cursor position is used. */
  pos?: number;
  /** Label for error logging (e.g. "paste", "drop", "insert"). */
  operation: string;
}

/**
 * Unified image-insert handler for all entry points (paste, drop, picker).
 *
 * Handles filename generation, alt-text derivation, save-callback invocation,
 * markdown insertion, and error logging in one place. All three image entry
 * points delegate to this function so the pipeline is defined exactly once.
 */
export function handleImageInsert(
  view: EditorView,
  file: File,
  options: HandleImageInsertOptions,
): Promise<void> {
  const save = options.save ?? fileToDataUrl;
  const ext = IMAGE_MIME_EXT[file.type] ?? "png";
  const baseName = generateImageFilename(file, ext);
  const alt = altTextFromFilename(baseName);

  return save(file)
    .then((path) => {
      insertImageMarkdown(view, path, alt, options.pos);
    })
    .catch((err: unknown) => {
      logImageError(options.operation, err);
    });
}

/**
 * Create an image handler bound to a save configuration.
 *
 * Use this factory when constructing CM6 extensions so the save callback
 * is resolved once at extension-creation time rather than per event.
 */
export function createImageHandler(
  config: ImageSaveConfig = {},
): (view: EditorView, file: File, operation: string, pos?: number) => Promise<void> {
  const save = config.saveImage ?? fileToDataUrl;
  return (view, file, operation, pos) =>
    handleImageInsert(view, file, { save, pos, operation });
}
