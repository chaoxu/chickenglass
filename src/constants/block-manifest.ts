/**
 * Centralized block type manifest — single source of truth for all block types.
 *
 * Every block plugin, CSS rule, and counter group derives from this manifest.
 * Adding a new block type means adding one entry here; downstream code
 * auto-generates theme rules and counter groups.
 */

/** Body font style for a block type. */
export type BodyStyle = "italic" | "normal";

/** Special rendering behaviors a block type can have. */
export type SpecialBehavior = "qed" | "blockquote";

/** Fenced-div renderer family for a block type. */
export type BlockPresentationKind =
  | "blockquote"
  | "captioned"
  | "standard";

/** How a block participates in LaTeX export. */
export type LatexExportKind =
  | "algorithm"
  | "blockquote"
  | "environment"
  | "figure"
  | "none"
  | "table";

/** Where the caption/header label is placed relative to block content. */
export type CaptionPosition = "above" | "below";

/** Whether the header label sits on its own block line or inline with content. */
export type HeaderPosition = "block" | "inline";

/** Manifest entry describing a single block type. */
export interface BlockManifestEntry {
  /** Block class name (e.g. "theorem"). */
  readonly name: string;
  /** Counter group this block belongs to. Undefined = unnumbered. */
  readonly counterGroup?: string;
  /** Whether this block type is auto-numbered. */
  readonly numbered: boolean;
  /** Body font style (italic for theorem-family, normal for others). */
  readonly bodyStyle: BodyStyle;
  /** Special rendering behavior, if any. */
  readonly specialBehavior?: SpecialBehavior;
  /** Conventional cross-reference prefix, without the trailing colon. */
  readonly referencePrefix?: string;
  /** LaTeX export strategy for this block type. Defaults to "environment". */
  readonly latexExportKind?: LatexExportKind;
  /** LaTeX environment name when latexExportKind is "environment". */
  readonly latexEnvironment?: string;
  /** Whether this block appears in semantic search type filters. Defaults to true. */
  readonly searchIndexed?: boolean;
  /** Where caption is placed. Defaults to "above". */
  readonly captionPosition?: CaptionPosition;
  /** Whether the rendered header is block-level or inline with the first body line. */
  readonly headerPosition?: HeaderPosition;
  /**
   * Display title for the rendered header. Defaults to the name with
   * the first letter capitalized. Override when the default capitalization
   * is wrong.
   */
  readonly title?: string;
  /**
   * Whether to show a rendered header label. Defaults to true.
   * Set to false for blocks like blockquote that render as styled
   * content without a label.
   */
  readonly displayHeader?: boolean;
}

/**
 * The complete block manifest.
 *
 * Order matches the registration order in default-plugins.ts.
 * Counter groups:
 * - "theorem": theorem, lemma, corollary, proposition, conjecture, problem
 * - "definition": definition
 * - "algorithm": algorithm
 * - unnumbered: proof, remark, example, blockquote
 */
export const BLOCK_MANIFEST = [
  // Theorem family — shared counter, italic body
  { name: "theorem",     counterGroup: "theorem",    numbered: true,  bodyStyle: "italic", referencePrefix: "thm",  latexExportKind: "environment", latexEnvironment: "theorem" },
  { name: "lemma",       counterGroup: "theorem",    numbered: true,  bodyStyle: "italic", referencePrefix: "lem",  latexExportKind: "environment", latexEnvironment: "lemma" },
  { name: "corollary",   counterGroup: "theorem",    numbered: true,  bodyStyle: "italic", referencePrefix: "cor",  latexExportKind: "environment", latexEnvironment: "corollary" },
  { name: "proposition", counterGroup: "theorem",    numbered: true,  bodyStyle: "italic", referencePrefix: "prop", latexExportKind: "environment", latexEnvironment: "proposition" },
  { name: "conjecture",  counterGroup: "theorem",    numbered: true,  bodyStyle: "italic", latexExportKind: "environment", latexEnvironment: "conjecture" },

  // Definition — own counter, normal body
  { name: "definition",  counterGroup: "definition", numbered: true,  bodyStyle: "normal", referencePrefix: "def", latexExportKind: "environment", latexEnvironment: "definition" },

  // Problem — theorem counter, normal body
  { name: "problem",     counterGroup: "theorem",    numbered: true,  bodyStyle: "normal", latexExportKind: "environment", latexEnvironment: "problem" },

  // Unnumbered blocks — no counter
  { name: "proof",       counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "qed", headerPosition: "inline", latexExportKind: "environment", latexEnvironment: "proof" },
  { name: "remark",      counterGroup: undefined,    numbered: false, bodyStyle: "normal", latexExportKind: "environment", latexEnvironment: "remark" },
  { name: "example",     counterGroup: undefined,    numbered: false, bodyStyle: "normal", latexExportKind: "environment", latexEnvironment: "example" },

  // Algorithm — own counter, normal body
  { name: "algorithm",   counterGroup: "algorithm",  numbered: true,  bodyStyle: "normal", referencePrefix: "alg", latexExportKind: "algorithm" },

  // Figure — own counter, caption below content
  { name: "figure",      counterGroup: "figure",     numbered: true,  bodyStyle: "normal", captionPosition: "below", referencePrefix: "fig", latexExportKind: "figure" },

  // Table — own counter, caption below content
  { name: "table",       counterGroup: "table",      numbered: true,  bodyStyle: "normal", captionPosition: "below", referencePrefix: "tbl", latexExportKind: "table" },

  // Blockquote — unnumbered, special rendering, no header label
  { name: "blockquote",  counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "blockquote", displayHeader: false, latexExportKind: "blockquote", searchIndexed: false },

] as const satisfies readonly BlockManifestEntry[];

/** Union type of all known block names. */
export type BlockName = (typeof BLOCK_MANIFEST)[number]["name"];

/**
 * Counter groups derived from the manifest.
 *
 * Maps each counter group name to the list of block names that share it.
 */
export const COUNTER_GROUPS: Readonly<Record<string, readonly BlockName[]>> = (() => {
  const groups: Record<string, BlockName[]> = {};
  for (const entry of BLOCK_MANIFEST) {
    if (entry.counterGroup) {
      (groups[entry.counterGroup] ??= []).push(entry.name);
    }
  }
  return groups;
})();

/**
 * BLOCK_MANIFEST typed as readonly BlockManifestEntry[] for property access.
 *
 * BLOCK_MANIFEST itself is inferred as a const tuple of narrow literal types,
 * so accessing optional properties like `specialBehavior` requires this alias.
 */
export const BLOCK_MANIFEST_ENTRIES: readonly BlockManifestEntry[] = BLOCK_MANIFEST;

/** @internal convenience alias used within this module */
const entries: readonly BlockManifestEntry[] = BLOCK_MANIFEST_ENTRIES;

export const BLOCK_MANIFEST_BY_NAME: ReadonlyMap<string, BlockManifestEntry> = new Map(
  BLOCK_MANIFEST_ENTRIES.map((entry) => [entry.name, entry] as const),
);

export function getBlockManifestEntry(blockType: string | undefined): BlockManifestEntry | undefined {
  return blockType ? BLOCK_MANIFEST_BY_NAME.get(blockType) : undefined;
}

export function isKnownManifestBlockType(blockType: string): boolean {
  return BLOCK_MANIFEST_BY_NAME.has(blockType);
}

export function getManifestBlockTitle(entry: BlockManifestEntry): string {
  return entry.title ?? `${entry.name.slice(0, 1).toUpperCase()}${entry.name.slice(1)}`;
}

export function getBlockPresentationKind(blockType: string): BlockPresentationKind {
  const entry = getBlockManifestEntry(blockType);
  if (entry?.specialBehavior === "blockquote") {
    return "blockquote";
  }
  if (entry?.captionPosition === "below") {
    return "captioned";
  }
  return "standard";
}

export function isSearchIndexedBlock(entry: BlockManifestEntry): boolean {
  return entry.searchIndexed ?? true;
}

export function isGenericFencedDivInsertBlock(_entry: BlockManifestEntry): boolean {
  return true;
}

/**
 * Block names excluded from fallback plugin generation.
 *
 * Explicitly empty: non-canonical legacy classes such as `include` now render
 * as ordinary fenced divs if they appear in old documents.
 */
export const EXCLUDED_FROM_FALLBACK: ReadonlySet<string> = new Set();

/**
 * Block names that have per-type accent CSS variables and body style CSS variables.
 *
 * Excludes blockquote, which doesn't use the standard
 * `--cf-block-{type}-accent` / `--cf-block-{type}-style` pattern.
 */
export const STYLED_BLOCK_NAMES: readonly string[] = entries
  .filter((e) => e.specialBehavior !== "blockquote")
  .map((e) => e.name);

export const LATEX_ENVIRONMENT_BY_BLOCK: ReadonlyMap<string, string> = new Map(
  BLOCK_MANIFEST_ENTRIES
    .filter((entry) => entry.latexExportKind === "environment" && entry.latexEnvironment)
    .map((entry) => [entry.name, entry.latexEnvironment ?? entry.name] as const),
);

export const CROSS_REFERENCE_PREFIXES: readonly string[] = [
  "sec",
  "eq",
  ...BLOCK_MANIFEST_ENTRIES
    .map((entry) => entry.referencePrefix)
    .filter((prefix): prefix is string => prefix !== undefined),
] as const;

/** Shared counter group name for theorem-family blocks. */
export const THEOREM_COUNTER = "theorem";

/** Counter group name for definition blocks. */
export const DEFINITION_COUNTER = "definition";

/** Counter group name for algorithm blocks. */
export const ALGORITHM_COUNTER = "algorithm";

/** Counter group name for figure blocks. */
export const FIGURE_COUNTER = "figure";

/** Counter group name for table blocks. */
export const TABLE_COUNTER = "table";
