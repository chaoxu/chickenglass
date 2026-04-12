import { uint8ArrayToBase64 } from "./utils";

const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  cur: "image/x-icon",
  gif: "image/gif",
  ico: "image/x-icon",
  jfif: "image/jpeg",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

function readPathExtension(path: string): string | null {
  const match = /\.([^./?#]+)(?:[?#].*)?$/i.exec(path);
  return match ? match[1].toLowerCase() : null;
}

function inferImageMimeType(path: string): string | null {
  const ext = readPathExtension(path);
  if (!ext) return null;
  return IMAGE_MIME_BY_EXT[ext] ?? `image/${ext}`;
}

function imageBytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${uint8ArrayToBase64(bytes)}`;
}

/**
 * Minimal structural shape for a binary-capable filesystem. Declared locally so
 * this module stays in `src/lib/` without pulling in the app-layer filesystem
 * interface.
 */
interface BinaryReadable {
  readFileBinary(path: string): Promise<Uint8Array>;
}

export async function readImageFileAsDataUrl(
  path: string,
  fs: BinaryReadable,
): Promise<string | null> {
  const mime = inferImageMimeType(path);
  if (!mime) return null;

  const bytes = await fs.readFileBinary(path);
  return imageBytesToDataUrl(bytes, mime);
}
