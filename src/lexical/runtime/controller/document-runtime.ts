import {
  buildDocumentLabelGraph,
  type DocumentScan,
  type DocumentLabelGraph,
  scanDocument,
} from "../../../app/markdown/labels";
import type { FrontmatterConfig } from "../../../lib/frontmatter";
import { parseFrontmatter } from "../../../lib/frontmatter";
import { type ProjectConfig, mergeConfigs } from "../../../project-config";
import { buildFootnoteDefinitionMap } from "../../markdown/footnotes";
import { buildRenderIndex, type RenderIndex } from "../../markdown/reference-index";
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
  scan: DocumentScan = scanDocument(doc),
): LexicalDocumentRuntime {
  const frontmatter = parseFrontmatter(doc);
  const config = mergeConfigs(projectConfig, frontmatter.config);

  return {
    config,
    footnoteDefinitions: buildFootnoteDefinitionMap(doc),
    labelGraph: buildDocumentLabelGraph(doc, scan),
    renderIndex: buildRenderIndex(doc, config, scan),
    resolveAssetUrl: resolver.resolveAssetUrl,
  };
}
