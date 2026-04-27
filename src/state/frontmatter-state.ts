/**
 * CM6 StateField that parses and caches frontmatter configuration.
 *
 * Provides `FrontmatterConfig` to other extensions via
 * `state.field(frontmatterField)`.
 *
 * Rendering (Typora-style title widget / YAML reveal) lives in
 * `render/frontmatter-render.ts`.
 */
import { EditorState, StateField, type Text } from "@codemirror/state";

import {
  type BlockConfig,
  isFrontmatterDelimiterLine,
  parseFrontmatter,
  type FrontmatterConfig,
  type FrontmatterResult,
  type FrontmatterStatus,
} from "../parser/frontmatter";
import { mergeConfigs, projectConfigFacet } from "../project-config";

export { type FrontmatterConfig, type NumberingScheme } from "../parser/frontmatter";

/** State stored in the frontmatter field. */
export interface FrontmatterState {
  /** Parsed configuration from the frontmatter. */
  config: FrontmatterConfig;
  /** Character offset where the frontmatter ends (-1 if none). */
  end: number;
  /** Structured parse status for diagnostics. */
  status: FrontmatterStatus;
  /** Increments only when the merged `blocks` config changes semantically. */
  blocksRevision: number;
}

interface FrontmatterStateInternal extends FrontmatterState {
  readonly blocksKey: string;
}

/** Parse frontmatter from an EditorState's document. */
function parseFrontmatterFromState(state: EditorState): FrontmatterResult {
  const frontmatterPrefix = sliceFrontmatterPrefix(state.doc);
  return frontmatterPrefix === null
    ? { config: {}, end: -1, status: { state: "missing" } }
    : parseFrontmatter(frontmatterPrefix);
}

function sliceFrontmatterPrefix(doc: Text): string | null {
  const firstLine = doc.line(1);
  const firstLineText = firstLine.text.charCodeAt(0) === 0xfeff
    ? firstLine.text.slice(1)
    : firstLine.text;
  if (!isFrontmatterDelimiterLine(firstLineText) || doc.lines < 2) {
    return null;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (!isFrontmatterDelimiterLine(line.text)) {
      continue;
    }
    const end = line.number < doc.lines ? line.to + 1 : line.to;
    return doc.sliceString(0, end);
  }

  return null;
}

function normalizeBlockConfig(config: BlockConfig): BlockConfig {
  const normalized: BlockConfig = {};
  if (config.counter !== undefined) normalized.counter = config.counter;
  if (config.numbered !== undefined) normalized.numbered = config.numbered;
  if (config.title !== undefined) normalized.title = config.title;
  return normalized;
}

function serializeBlocksConfig(blocks: FrontmatterConfig["blocks"]): string {
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
  return { config, end: result.end, status: result.status, blocksRevision, blocksKey };
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

    let affectsFrontmatter = false;

    if (value.end === -1) {
      const startsWithDelimiter = tr.state.doc.length >= 3
        && (
          tr.state.doc.sliceString(0, 3) === "---"
          || tr.state.doc.sliceString(0, 4) === "\ufeff---"
        );
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
