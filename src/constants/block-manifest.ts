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
  /** Where caption is placed. Defaults to "above". */
  readonly captionPosition?: CaptionPosition;
  /** Whether the rendered header is block-level or inline with the first body line. */
  readonly headerPosition?: HeaderPosition;
  /**
   * Display title for the rendered header. Defaults to the name with
   * the first letter capitalized. Override when the default capitalization
   * is wrong (e.g. "YouTube" instead of "Youtube").
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
  { name: "proof",       counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "qed", headerPosition: "inline" },
  { name: "remark",      counterGroup: undefined,    numbered: false, bodyStyle: "normal" },
  { name: "example",     counterGroup: undefined,    numbered: false, bodyStyle: "normal" },

  // Algorithm — own counter, normal body
  { name: "algorithm",   counterGroup: "algorithm",  numbered: true,  bodyStyle: "normal" },

  // Figure — own counter, caption below content
  { name: "figure",      counterGroup: "figure",     numbered: true,  bodyStyle: "normal", captionPosition: "below" },

  // Table — own counter, caption below content
  { name: "table",       counterGroup: "table",      numbered: true,  bodyStyle: "normal", captionPosition: "below" },

  // Blockquote — unnumbered, special rendering, no header label
  { name: "blockquote",  counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "blockquote", displayHeader: false },

  // Embed family — unnumbered, embed behavior
  { name: "embed",       counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed" },
  { name: "iframe",      counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed" },
  { name: "youtube",     counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed", title: "YouTube" },
  { name: "gist",        counterGroup: undefined,    numbered: false, bodyStyle: "normal", specialBehavior: "embed" },
] as const satisfies readonly BlockManifestEntry[];

/** Union type of all known block names. */
export type BlockName = (typeof BLOCK_MANIFEST)[number]["name"];

/**
 * BLOCK_MANIFEST typed as readonly BlockManifestEntry[] for property access.
 *
 * BLOCK_MANIFEST itself is inferred as a const tuple of narrow literal types,
 * so accessing optional properties like `specialBehavior` requires this alias.
 */
export const BLOCK_MANIFEST_ENTRIES: readonly BlockManifestEntry[] = BLOCK_MANIFEST;

/** Shared counter group name for theorem-family blocks. */
export const THEOREM_COUNTER = "theorem";

/** Counter group name for definition blocks. */
export const DEFINITION_COUNTER = "definition";

/** Counter group name for algorithm blocks. */
export const ALGORITHM_COUNTER = "algorithm";
