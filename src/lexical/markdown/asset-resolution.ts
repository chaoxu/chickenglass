import { classifyAssetTarget } from "../../lib/markdown-image";
import {
  normalizeMarkdownReferencePath,
  resolveMarkdownReferencePathFromDocument,
} from "../../lib/markdown-reference-paths";

export function buildStaticAssetUrl(docPath: string | undefined, targetPath: string): string | null {
  const target = classifyAssetTarget(targetPath);
  const basePath = docPath
    ? resolveMarkdownReferencePathFromDocument(docPath, targetPath)
    : normalizeMarkdownReferencePath(targetPath);
  if (!basePath || !target.isLocal) {
    return targetPath || null;
  }
  const segments = basePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return `/demo/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}
