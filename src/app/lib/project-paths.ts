import { dirname } from "./utils";

function splitProjectPath(path: string): string[] {
  const normalized = normalizeProjectPath(path);
  return normalized ? normalized.split("/") : [];
}

/**
 * Normalize a project-relative path.
 *
 * - strips a leading slash so the result stays project-relative
 * - resolves `.` and `..`
 * - converts backslashes to forward slashes
 */
export function normalizeProjectPath(path: string): string {
  const parts = path.replaceAll("\\", "/").replace(/^\/+/, "").split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return resolved.join("/");
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

/**
 * Convert a project-relative target path back into markdown path text
 * relative to the current document.
 */
export function relativeProjectPathFromDocument(
  docPath: string,
  targetPath: string,
): string {
  const fromParts = splitProjectPath(dirname(docPath));
  const toParts = splitProjectPath(targetPath);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const upward = new Array(fromParts.length - common).fill("..");
  const downward = toParts.slice(common);
  const relativeParts = [...upward, ...downward];

  return relativeParts.length > 0 ? relativeParts.join("/") : ".";
}
