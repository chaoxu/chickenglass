/**
 * Project-relative path utilities.
 *
 * No dependency on React or DOM — safe to import from any layer.
 */

import { normalize } from "pathe";
import { dirname } from "./utils";

/**
 * Normalize a project-relative path.
 *
 * - strips a leading slash so the result stays project-relative
 * - resolves `.` and `..`
 * - converts backslashes to forward slashes
 *
 * Uses pathe's `normalize` for the heavy lifting, then applies
 * project-specific policy: strip leading slashes and map `"."` to `""`.
 */
export function normalizeProjectPath(path: string): string {
  const n = normalize(path)
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  return n === "." ? "" : n;
}

export function isSameProjectPath(left: string, right: string): boolean {
  return normalizeProjectPath(left) === normalizeProjectPath(right);
}

export function isDescendantProjectPath(child: string, parent: string): boolean {
  const normalizedChild = normalizeProjectPath(child);
  const normalizedParent = normalizeProjectPath(parent);
  if (normalizedChild === normalizedParent) {
    return false;
  }
  if (normalizedParent === "") {
    return normalizedChild !== "";
  }
  return normalizedChild.startsWith(`${normalizedParent}/`);
}

export function isSameOrDescendantProjectPath(child: string, parent: string): boolean {
  return isSameProjectPath(child, parent) || isDescendantProjectPath(child, parent);
}

/**
 * Resolve a project path relative to the current document.
 *
 * Absolute-style project paths (`/assets/foo.png`) are treated as project-root
 * relative and returned without the leading slash.
 */
export function resolveProjectPathFromDocument(
  docPath: string,
  targetPath: string,
): string {
  if (targetPath.startsWith("/")) {
    return normalizeProjectPath(targetPath);
  }

  const docDir = dirname(docPath);
  return normalizeProjectPath(docDir ? `${docDir}/${targetPath}` : targetPath);
}

/**
 * Return the candidate project-relative paths for a document-local reference.
 *
 * Most document references first resolve relative to the document and then
 * fall back to project-root resolution when the document-local path is absent.
 */
export function projectPathCandidatesFromDocument(
  docPath: string,
  targetPath: string,
): string[] {
  const resolved = resolveProjectPathFromDocument(docPath, targetPath);
  const rootRelative = normalizeProjectPath(targetPath);
  return resolved === rootRelative ? [resolved] : [resolved, rootRelative];
}
