import { normalizeProjectPath, resolveProjectPathFromDocument } from "../../lib/project-paths";

export function buildStaticAssetUrl(docPath: string | undefined, targetPath: string): string | null {
  const basePath = docPath ? resolveProjectPathFromDocument(docPath, targetPath) : normalizeProjectPath(targetPath);
  if (!basePath || targetPath.startsWith("/") || targetPath.startsWith("\\") || /^(?:https?:|data:)/i.test(targetPath)) {
    return targetPath || null;
  }
  const segments = basePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return `/demo/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}
