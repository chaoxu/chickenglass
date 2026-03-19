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

import type { FileSystem } from "../app/file-manager";
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

/** Check whether a MIME type is a supported image type. */
export function isImageMime(mime: string): boolean {
  return mime in IMAGE_MIME_EXT;
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
export function fileToUint8Array(file: File): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsArrayBuffer(file);
  });
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
  if (file.name && file.name !== "image.png" && file.name !== "blob") {
    return file.name;
  }
  return `image-${Date.now()}.${ext}`;
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

  // Compute the directory relative to the document
  const docDir = docPath.includes("/")
    ? docPath.slice(0, docPath.lastIndexOf("/"))
    : "";
  const targetDir = docDir ? `${docDir}/${imageFolder}` : imageFolder;

  // Ensure the target directory exists
  try {
    const dirExists = await fs.exists(targetDir);
    if (!dirExists) {
      await fs.createDirectory(targetDir);
    }
  } catch {
    // Directory might already exist (race condition or implicit via file creation)
  }

  // Generate a unique filename
  const rawFilename = generateImageFilename(file, ext);
  const filename = await deduplicateFilename(fs, targetDir, rawFilename);
  const relativePath = `${targetDir}/${filename}`;

  // Write the binary data
  const data = await fileToUint8Array(file);
  await fs.writeFileBinary(relativePath, data);

  // Return the path relative to the document for markdown insertion
  return `${imageFolder}/${filename}`;
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
