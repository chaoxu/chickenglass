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

import type { FileSystem } from "../lib/types";
import {
  relativeProjectPathFromDocument,
  resolveProjectPathFromDocument,
} from "../app/lib/project-paths";
import { isTauri } from "../app/tauri-fs";

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
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/** Convert a File to a Uint8Array. */
function fileToUint8Array(file: File): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsArrayBuffer(file);
  });
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
  const targetDir = resolveProjectPathFromDocument(docPath, imageFolder);

  if (targetDir) {
    try {
      const dirExists = await fs.exists(targetDir);
      if (!dirExists) {
        await fs.createDirectory(targetDir);
      }
    } catch {
      // best-effort: directory might already exist (race condition or implicit via file creation)
    }
  }

  const filename = targetDir
    ? await deduplicateFilename(fs, targetDir, rawFilename)
    : rawFilename;
  const targetPath = targetDir ? `${targetDir}/${filename}` : filename;

  return {
    targetPath,
    markdownPath: relativeProjectPathFromDocument(docPath, targetPath),
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
 * Shared save-and-insert pipeline for image files.
 *
 * All insertion paths (paste, drop, file picker) go through this function
 * so that filename generation, alt-text derivation, save callback invocation,
 * and markdown insertion happen in exactly one place.
 *
 * @param file       The image File to process.
 * @param save       Callback that persists the image and returns a path/URL.
 * @param insert     Callback that inserts the markdown snippet into the editor.
 * @param operation  Label used in error logging (e.g. "paste", "drop", "insert").
 * @returns          A promise that resolves after insert (or after logging an error).
 */
export function saveAndInsertImage(
  file: File,
  save: (file: File) => Promise<string>,
  insert: (path: string, alt: string) => void,
  operation: string,
): Promise<void> {
  const ext = IMAGE_MIME_EXT[file.type] ?? "png";
  const baseName = generateImageFilename(file, ext);
  const alt = altTextFromFilename(baseName);

  return save(file)
    .then((path) => {
      insert(path, alt);
    })
    .catch((err: unknown) => {
      logImageError(operation, err);
    });
}
