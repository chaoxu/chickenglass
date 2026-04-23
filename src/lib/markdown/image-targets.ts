import { parser as baseParser } from "@lezer/markdown";
import { htmlRenderExtensions } from "../../parser";

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
