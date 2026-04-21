import type { FileSystem } from "../../../app/file-manager";
import { normalizeProjectPath, projectPathCandidatesFromDocument } from "../../../lib/project-paths";
import { buildStaticAssetUrl } from "../../markdown/asset-resolution";

export interface LexicalRenderResourceResolver {
  readonly docPath?: string;
  readonly fs: FileSystem;
  readonly readProjectTextFile: (targetPath: string) => Promise<string | null>;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

function getProjectPathCandidates(
  docPath: string | undefined,
  targetPath: string,
): readonly string[] {
  const normalizedTarget = targetPath.trim();
  if (normalizedTarget.length === 0) {
    return [];
  }

  if (docPath) {
    return projectPathCandidatesFromDocument(docPath, normalizedTarget);
  }

  const normalized = normalizeProjectPath(normalizedTarget);
  return normalized ? [normalized] : [];
}

async function readFirstAvailableTextFile(
  fs: FileSystem,
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function createLexicalRenderResourceResolver(
  fs: FileSystem,
  docPath?: string,
): LexicalRenderResourceResolver {
  return {
    docPath,
    fs,
    readProjectTextFile: (targetPath: string) =>
      readFirstAvailableTextFile(fs, getProjectPathCandidates(docPath, targetPath)),
    resolveAssetUrl: (targetPath: string) => buildStaticAssetUrl(docPath, targetPath),
  };
}
