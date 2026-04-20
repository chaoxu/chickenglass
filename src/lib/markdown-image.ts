export interface MarkdownImage {
  readonly alt: string;
  readonly src: string;
}

export type AssetTargetKind =
  | "absolute-path"
  | "data-url"
  | "local"
  | "protocol-relative-url"
  | "protocol-url";

export interface AssetTargetClassification {
  readonly isLocal: boolean;
  readonly isPdf: boolean;
  readonly kind: AssetTargetKind;
}

export const MARKDOWN_IMAGE_RE = /^!\[([^\]\n]*)\]\(([^)\n]+)\)\s*$/;
export const MARKDOWN_IMAGE_IMPORT_RE = /!\[[^\]\n]*\]\([^)]+\)/;
export const MARKDOWN_IMAGE_SHORTCUT_RE = /!\[[^\]\n]*\]\([^)]+\)$/;
export const MARKDOWN_IMAGE_LINE_RE = /^\s*!\[[^\]\n]*\]\([^)]+\)\s*$/;

export function parseMarkdownImage(raw: string): MarkdownImage | null {
  const match = raw.trim().match(MARKDOWN_IMAGE_RE);
  if (!match) {
    return null;
  }
  return {
    alt: match[1] ?? "",
    src: (match[2] ?? "").trim(),
  };
}

export function isMarkdownImageLine(line: string): boolean {
  return MARKDOWN_IMAGE_LINE_RE.test(line);
}

export function classifyAssetTarget(target: string): AssetTargetClassification {
  let kind: AssetTargetKind = "local";
  if (/^data:/i.test(target)) {
    kind = "data-url";
  } else if (target.startsWith("//")) {
    kind = "protocol-relative-url";
  } else if (/^(?:[a-z]:[\\/]|[\\/])/i.test(target)) {
    kind = "absolute-path";
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    kind = "protocol-url";
  }

  return {
    isLocal: kind === "local",
    isPdf: /\.pdf(?:$|[?#])/i.test(target),
    kind,
  };
}
