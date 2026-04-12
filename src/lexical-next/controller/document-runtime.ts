import {
  buildDocumentLabelGraph,
  type DocumentLabelGraph,
  scanDocument,
} from "../../app/markdown/labels";
import type { FrontmatterConfig } from "../../lib/frontmatter";
import { parseFrontmatter } from "../../lib/frontmatter";
import { type ProjectConfig, mergeConfigs } from "../../project-config";
import { buildFootnoteDefinitionMap } from "../../lexical/markdown/footnotes";
import { buildRenderIndex, type RenderIndex } from "../../lexical/markdown/reference-index";
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
): LexicalDocumentRuntime {
  const frontmatter = parseFrontmatter(doc);
  const config = mergeConfigs(projectConfig, frontmatter.config);
  const scan = scanDocument(doc);

  return {
    config,
    footnoteDefinitions: buildFootnoteDefinitionMap(doc),
    labelGraph: buildDocumentLabelGraph(doc, scan),
    renderIndex: buildRenderIndex(doc, config, scan),
    resolveAssetUrl: resolver.resolveAssetUrl,
  };
}
