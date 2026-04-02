import { parser as baseParser } from "@lezer/markdown";
import { htmlRenderExtensions } from "../parser";
import { readImageFileAsDataUrl } from "../lib/image-data-url";
import { isPdfTarget, isRelativeFilePath } from "../lib/pdf-target";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import type { FileSystem } from "../lib/types";
import { rasterizePdfPage1 } from "../render/pdf-rasterizer";

const previewParser = baseParser.configure(htmlRenderExtensions);

export function collectImageTargets(content: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const tree = previewParser.parse(content);

  tree.iterate({
    enter(node) {
      if (node.type.name !== "Image") return;
      const urlNode = node.node.getChild("URL");
      if (!urlNode) return;

      const src = content.slice(urlNode.from, urlNode.to).trim();
      if (!src || seen.has(src)) return;

      seen.add(src);
      targets.push(src);
    },
  });

  return targets;
}

/**
 * Resolve local file-backed image targets in a document.
 *
 * Returns a map keyed by the resolved project-relative image path so callers
 * can feed browser-safe data URLs back into the HTML renderer.
 */
export async function resolveLocalImageOverrides(
  content: string,
  fs: FileSystem | undefined,
  docPath = "",
): Promise<ReadonlyMap<string, string>> {
  if (!fs) return new Map();

  const resolvedImagePaths = [...new Set(
    collectImageTargets(content)
      .filter(isRelativeFilePath)
      .map((src) => resolveProjectPathFromDocument(docPath, src)),
  )];

  if (resolvedImagePaths.length === 0) return new Map();

  const results = await Promise.all(resolvedImagePaths.map(async (path) => {
    try {
      if (isPdfTarget(path)) {
        const bytes = await fs.readFileBinary(path);
        const canvas = await rasterizePdfPage1(bytes);
        if (!canvas) return null;
        // Read mode needs a data URL for <img src="">
        const dataUrl = canvas.toDataURL("image/png");
        return typeof dataUrl === "string" ? ([path, dataUrl] as const) : null;
      }

      const dataUrl = await readImageFileAsDataUrl(path, fs);
      return dataUrl ? ([path, dataUrl] as const) : null;
    } catch {
      return null;
    }
  }));

  return new Map(
    results.filter((entry): entry is readonly [string, string] => entry !== null),
  );
}
