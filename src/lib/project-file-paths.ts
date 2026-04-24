/**
 * Project file command path utilities.
 *
 * A ProjectFilePath is a frontend path that is already relative to the active
 * project root and is suitable for Tauri/file-system command transport. This
 * module deliberately does not normalize markdown syntax such as `..`,
 * leading slashes, or document-relative asset paths; backend command handlers
 * are the safety authority for filesystem containment.
 */

declare const projectFilePathBrand: unique symbol;

export type ProjectFilePath = string & {
  readonly [projectFilePathBrand]: true;
};

export function projectFilePath(path: string): ProjectFilePath {
  return path as ProjectFilePath;
}
