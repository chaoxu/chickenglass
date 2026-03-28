/**
 * CM6 StateField that parses and caches frontmatter configuration.
 *
 * Provides `FrontmatterConfig` to other extensions via
 * `state.field(frontmatterField)`.
 *
 * Rendering (Typora-style title widget / YAML reveal) lives in
 * `./frontmatter-render.ts`.
 */
import { EditorState, StateField } from "@codemirror/state";

import {
  type BlockConfig,
  parseFrontmatter,
  type FrontmatterConfig,
  type FrontmatterResult,
} from "../parser/frontmatter";
import { projectConfigFacet, mergeConfigs } from "./project-config";

export { type FrontmatterConfig, type NumberingScheme } from "../parser/frontmatter";

/** State stored in the frontmatter field. */
export interface FrontmatterState {
  /** Parsed configuration from the frontmatter. */
  config: FrontmatterConfig;
  /** Character offset where the frontmatter ends (-1 if none). */
  end: number;
  /** Increments only when the merged `blocks` config changes semantically. */
  blocksRevision: number;
}

interface FrontmatterStateInternal extends FrontmatterState {
  readonly blocksKey: string;
}

/** Parse frontmatter from an EditorState's document. */
function parseFrontmatterFromState(state: EditorState): FrontmatterResult {
  return parseFrontmatter(state.doc.toString());
}

function normalizeBlockConfig(config: BlockConfig): BlockConfig {
  const normalized: BlockConfig = {};
  if (config.counter !== undefined) normalized.counter = config.counter;
  if (config.numbered !== undefined) normalized.numbered = config.numbered;
  if (config.title !== undefined) normalized.title = config.title;
  return normalized;
}

function serializeBlocksConfig(
  blocks: FrontmatterConfig["blocks"],
): string {
  if (!blocks) return "";
  const names = Object.keys(blocks).sort();
  if (names.length === 0) return "";
  return JSON.stringify(names.map((name) => {
    const value = blocks[name];
    return [
      name,
      typeof value === "boolean" ? value : normalizeBlockConfig(value),
    ];
  }));
}

function buildFrontmatterState(
  state: EditorState,
  previous?: FrontmatterStateInternal,
): FrontmatterStateInternal {
  const result = parseFrontmatterFromState(state);
  const project = state.facet(projectConfigFacet);
  const config = mergeConfigs(project, result.config);
  const blocksKey = serializeBlocksConfig(config.blocks);
  const blocksRevision = previous && previous.blocksKey !== blocksKey
    ? previous.blocksRevision + 1
    : previous?.blocksRevision ?? 0;
  return { config, end: result.end, blocksRevision, blocksKey };
}

/**
 * CM6 StateField holding the parsed frontmatter config.
 *
 * Usage:
 * ```ts
 * const config = state.field(frontmatterField).config;
 * ```
 */
export const frontmatterField = StateField.define<FrontmatterStateInternal>({
  create(state) {
    return buildFrontmatterState(state);
  },

  update(value, tr) {
    if (!tr.docChanged) return value;

    // Check if the change affects the frontmatter region.
    // If the frontmatter ends at `value.end`, any change before that
    // offset (or at position 0) could modify the frontmatter.
    let affectsFrontmatter = false;

    if (value.end === -1) {
      // No frontmatter currently: re-parse if the change is at the start,
      // or if the doc already starts with --- and any edit could complete
      // the closing delimiter. Without this check, typing a closing ---
      // after an opening --- is missed because the edit position > 0.
      // See issue #494.
      const startsWithDelimiter = tr.state.doc.length >= 3
        && tr.state.doc.sliceString(0, 3) === "---";
      tr.changes.iterChangedRanges((fromA) => {
        if (fromA === 0 || startsWithDelimiter) affectsFrontmatter = true;
      });
    } else {
      tr.changes.iterChangedRanges((fromA) => {
        if (fromA < value.end) affectsFrontmatter = true;
      });
    }

    if (!affectsFrontmatter) return value;

    return buildFrontmatterState(tr.state, value);
  },
});

