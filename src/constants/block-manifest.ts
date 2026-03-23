/**
 * Centralized block type manifest — single source of truth for all block types.
 *
 * Every block plugin, CSS rule, and counter group derives from this manifest.
 * Adding a new block type means adding one entry here; downstream code
 * auto-generates theme rules, counter groups, and embed/exclusion sets.
 */

/** Body font style for a block type. */
export type BodyStyle = "italic" | "normal";

/** Special rendering behaviors a block type can have. */
export type SpecialBehavior = "qed" | "embed" | "blockquote";

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
}

/**
 * The complete block manifest.
 *
 * Order matches the registration order in default-plugins.ts.
 * Counter groups:
 * - "theorem": theorem, lemma, corollary, proposition, conjecture, problem
 * - "definition": definition
 * - "algorithm": algorithm
 * - unnumbered: proof, remark, example, embed, iframe, youtube, gist, blockquote
 */
export const BLOCK_MANIFEST = [
  // Theorem family — shared counter, italic body
  { name: "theorem",     counterGroup: "theorem",    numbered: true,  bodyStyle: "italic" },
  { name: "lemma",       counterGroup: "theorem",    numbered: true,  bodyStyle: "italic" },
  { name: "corollary",   counterGroup: "theorem",    numbered: true,  bodyStyle: "italic" },
  { name: "proposition", counterGroup: "theorem",    numbered: true,  bodyStyle: "italic" },
  { name: "conjecture",  counterGroup: "theorem",    numbered: true,  bodyStyle: "italic" },

  // Definition — own counter, normal body
  { name: "definition",  counterGroup: "definition", numbered: true,  bodyStyle: "normal" },

  // Problem — theorem counter, normal body
  { name: "problem",     counterGroup: "theorem",    numbered: true,  bodyStyle: "normal" },

  // Unnumbered blocks — no counter
  { name: "proof",       counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "qed" },
  { name: "remark",      counterGroup: undefined,    numbered: false, bodyStyle: "normal" },
  { name: "example",     counterGroup: undefined,    numbered: false, bodyStyle: "normal" },

  // Algorithm — own counter, normal body
  { name: "algorithm",   counterGroup: "algorithm",  numbered: true,  bodyStyle: "normal" },

  // Blockquote — unnumbered, special rendering
  { name: "blockquote",  counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "blockquote" },

  // Embed family — unnumbered, embed behavior
  { name: "embed",       counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed" },
  { name: "iframe",      counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed" },
  { name: "youtube",     counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed" },
  { name: "gist",        counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed" },
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

/** Block names that use embed rendering (iframe replacement). */
export const EMBED_CLASSES: ReadonlySet<string> = new Set(
  entries
    .filter((e) => e.specialBehavior === "embed")
    .map((e) => e.name),
);

/**
 * Block names excluded from fallback plugin generation.
 *
 * These class names are handled by special-purpose code in the renderer
 * and should not get a generic "numbered block" fallback.
 */
export const EXCLUDED_FROM_FALLBACK: ReadonlySet<string> = new Set(["include"]);

/**
 * Block names that have per-type accent CSS variables and body style CSS variables.
 *
 * Excludes embed types and blockquote, which don't use the standard
 * `--cf-block-{type}-accent` / `--cf-block-{type}-style` pattern.
 */
export const STYLED_BLOCK_NAMES: readonly string[] = entries
  .filter((e) => e.specialBehavior !== "embed" && e.specialBehavior !== "blockquote")
  .map((e) => e.name);

/** Shared counter group name for theorem-family blocks. */
export const THEOREM_COUNTER = "theorem";

/** Counter group name for definition blocks. */
export const DEFINITION_COUNTER = "definition";

/** Counter group name for algorithm blocks. */
export const ALGORITHM_COUNTER = "algorithm";
