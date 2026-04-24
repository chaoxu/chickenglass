/**
 * Markdown reference path utilities.
 *
 * These helpers are for document-authored paths such as image URLs,
 * bibliography frontmatter, and media references. They intentionally follow
 * markdown-style resolution: document-relative paths may contain `.`/`..`,
 * and a leading slash means project-root relative.
 *
 * Do not use these helpers for Tauri filesystem command arguments. Native
 * commands receive already project-relative file paths and the backend owns
 * filesystem safety validation.
 */

import { normalize } from "pathe";
import { dirname } from "./utils";

function splitMarkdownReferencePath(path: string): string[] {
  const normalized = normalizeMarkdownReferencePath(path);
  return normalized ? normalized.split("/") : [];
}

export function normalizeMarkdownReferencePath(path: string): string {
  const normalized = normalize(path).replace(/^\/+/, "");
  return normalized === "." ? "" : normalized;
}

export function resolveMarkdownReferencePathFromDocument(
  docPath: string,
  targetPath: string,
): string {
  if (targetPath.startsWith("/")) {
    return normalizeMarkdownReferencePath(targetPath);
  }

  const docDir = dirname(docPath);
  return normalizeMarkdownReferencePath(docDir ? `${docDir}/${targetPath}` : targetPath);
}

export function markdownReferencePathCandidatesFromDocument(
  docPath: string,
  targetPath: string,
): string[] {
  const resolved = resolveMarkdownReferencePathFromDocument(docPath, targetPath);
  const rootRelative = normalizeMarkdownReferencePath(targetPath);
  return resolved === rootRelative ? [resolved] : [resolved, rootRelative];
}

export function relativeMarkdownReferencePathFromDocument(
  docPath: string,
  targetPath: string,
): string {
  const fromParts = splitMarkdownReferencePath(dirname(docPath));
  const toParts = splitMarkdownReferencePath(targetPath);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }

  const upward = new Array(fromParts.length - common).fill("..");
  const downward = toParts.slice(common);
  const relativeParts = [...upward, ...downward];

  return relativeParts.length > 0 ? relativeParts.join("/") : ".";
}
