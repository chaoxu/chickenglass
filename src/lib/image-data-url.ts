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

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiHeader(bytes: Uint8Array, length = 256): string {
  return new TextDecoder().decode(bytes.slice(0, length)).trimStart().toLowerCase();
}

function looksLikeImageBytes(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length === 0) {
    return false;
  }

  switch (mime) {
    case "image/apng":
    case "image/png":
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38]);
    case "image/jpeg":
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    case "image/svg+xml": {
      const header = asciiHeader(bytes);
      return header.startsWith("<svg") || (header.startsWith("<?xml") && header.includes("<svg"));
    }
    case "image/webp":
      return (
        startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
        && bytes[8] === 0x57
        && bytes[9] === 0x45
        && bytes[10] === 0x42
        && bytes[11] === 0x50
      );
    case "image/bmp":
      return startsWithBytes(bytes, [0x42, 0x4d]);
    case "image/x-icon":
      return (
        bytes[0] === 0x00
        && bytes[1] === 0x00
        && (bytes[2] === 0x01 || bytes[2] === 0x02)
        && bytes[3] === 0x00
      );
    default:
      return true;
  }
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
  if (!looksLikeImageBytes(bytes, mime)) {
    return null;
  }
  return imageBytesToDataUrl(bytes, mime);
}
