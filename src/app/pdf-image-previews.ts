import { parser as baseParser } from "@lezer/markdown";
import { htmlRenderExtensions } from "../parser";
import { isPdfTarget } from "../lib/pdf-target";
import { resolveProjectPathFromDocument } from "../lib/project-paths";
import type { FileSystem } from "../lib/types";
import { rasterizePdfPage1 } from "../render/pdf-rasterizer";

const previewParser = baseParser.configure(htmlRenderExtensions);

function collectImageTargets(content: string): string[] {
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
 * Resolve and rasterize PDF-backed image targets in a document.
 *
 * Returns a map keyed by the resolved project-relative PDF path so callers can
 * feed the prepared preview image back into the HTML renderer.
 */
export async function resolvePdfImageOverrides(
  content: string,
  fs: FileSystem | undefined,
  docPath = "",
): Promise<ReadonlyMap<string, string>> {
  if (!fs) return new Map();

  const resolvedPdfPaths = [...new Set(
    collectImageTargets(content)
      .filter(isPdfTarget)
      .map((src) => resolveProjectPathFromDocument(docPath, src)),
  )];

  if (resolvedPdfPaths.length === 0) return new Map();

  const results = await Promise.all(resolvedPdfPaths.map(async (path) => {
    try {
      const bytes = await fs.readFileBinary(path);
      const canvas = await rasterizePdfPage1(bytes);
      if (!canvas) return null;
      // Read mode needs a data URL for <img src="">
      const dataUrl = canvas.toDataURL("image/png");
      return typeof dataUrl === "string" ? ([path, dataUrl] as const) : null;
    } catch {
      return null;
    }
  }));

  return new Map(
    results.filter((entry): entry is readonly [string, string] => entry !== null),
  );
}
