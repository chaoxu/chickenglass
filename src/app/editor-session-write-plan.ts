import type { SourceMap } from "./source-map";

export interface ProjectedWrite {
  path: string;
  content: string;
}

/**
 * Build the set of file writes needed to persist the current composed editor document.
 *
 * When a source map is present, included regions are written back to their owning
 * files and the main file is reconstructed with its include directives restored.
 */
export function buildProjectedWritePlan(
  targetPath: string,
  doc: string,
  sourceMap: SourceMap | null,
): ProjectedWrite[] {
  if (!sourceMap) {
    return [{ path: targetPath, content: doc }];
  }

  const writes = [...sourceMap.decompose(doc).entries()].map(([path, content]) => ({
    path,
    content,
  }));
  writes.push({
    path: targetPath,
    content: sourceMap.reconstructMain(doc, targetPath),
  });
  return writes;
}
