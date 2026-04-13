import { buildDocumentLabelGraphFromSnapshot, type DocumentLabelGraph } from "../../app/markdown/label-graph";
import { buildDocumentLabelParseSnapshot } from "../../app/markdown/label-parser";
import type { FrontmatterConfig } from "../../lib/frontmatter";
import { parseFrontmatter } from "../../lib/frontmatter";
import { type ProjectConfig, mergeConfigs } from "../../project-config";
import { buildFootnoteDefinitionMap } from "../../lexical/markdown/footnotes";
import { buildRenderIndexFromSnapshot, type RenderIndex } from "../../lexical/markdown/reference-index";
import type { LexicalRenderResourceResolver } from "./resource-resolver";

export interface LexicalDocumentRuntime {
  readonly config: FrontmatterConfig;
  readonly footnoteDefinitions: ReadonlyMap<string, string>;
  readonly labelGraph: DocumentLabelGraph;
  readonly renderIndex: RenderIndex;
  readonly resolveAssetUrl: (targetPath: string) => string | null;
}

export function buildDocumentRuntime(
  doc: string,
  projectConfig: ProjectConfig,
  resolver: Pick<LexicalRenderResourceResolver, "resolveAssetUrl">,
  snapshot = buildDocumentLabelParseSnapshot(doc),
): LexicalDocumentRuntime {
  const frontmatter = parseFrontmatter(doc);
  const config = mergeConfigs(projectConfig, frontmatter.config);

  return {
    config,
    footnoteDefinitions: buildFootnoteDefinitionMap(doc),
    labelGraph: buildDocumentLabelGraphFromSnapshot(snapshot),
    renderIndex: buildRenderIndexFromSnapshot(snapshot, config),
    resolveAssetUrl: resolver.resolveAssetUrl,
  };
}
