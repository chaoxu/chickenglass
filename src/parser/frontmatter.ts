/**
 * YAML frontmatter parser for Coflat documents.
 *
 * Uses the standard `yaml` npm package for parsing. Boundary detection
 * (`extractRawFrontmatter`) is kept as a custom Lezer-independent function.
 */

import { parse as parseYaml } from "yaml";

export interface BlockConfig {
  /**
   * Counter group name. Semantics:
   * - `string` — use this counter group (e.g. `"theorem"`)
   * - `null` — explicitly remove counter group (own counter)
   * - `undefined` — not specified; inherit from existing/built-in plugin
   */
  counter?: string | null;
  numbered?: boolean;
  title?: string;
}

/** How numbered blocks are counted across the document. */
export type NumberingScheme = "global" | "grouped";

export interface FrontmatterConfig {
  title?: string;
  bibliography?: string;
  csl?: string;
  latex?: {
    bibliography?: string;
    template?: string;
  };
  /**
   * Numbering scheme for theorem-like blocks.
   * - "global": all numbered blocks share one counter (blog style)
   * - "grouped": separate counters per group (default, academic style)
   */
  numbering?: NumberingScheme;
  /**
   * Per-plugin block configuration overrides.
   *
   * Keys are plugin class names (e.g. `"theorem"`, `"lemma"`). Values are
   * either:
   * - `true` / `false` — enable or disable the plugin for this document.
   * - A `BlockConfig` object for fine-grained control:
   *   - `numbered?: boolean` — override the plugin's default numbered setting.
   *   - `counter?: string` — assign a shared counter group name; plugins with
   *     the same `counter` value increment one shared sequence.
   *   - `title?: string` — override the default display title for the label.
   *
   * Example YAML:
   * ```yaml
   * blocks:
   *   theorem:
   *     numbered: true
   *     counter: theorem
   *   lemma:
   *     numbered: true
   *     counter: theorem   # shares "Theorem 1, Lemma 2, …" counter
   *   remark: false        # disable remark blocks entirely
   * ```
   */
  blocks?: Record<string, boolean | BlockConfig>;
  /**
   * KaTeX macro definitions for this document.
   *
   * Keys are macro names (including the leading backslash, e.g. `"\\R"`).
   * Values are their LaTeX expansions (e.g. `"\\mathbb{R}"`). These are
   * merged into the KaTeX `macros` option at render time and cached in the
   * `mathMacrosField` StateField, which recomputes only when frontmatter
   * changes.
   *
   * Example YAML:
   * ```yaml
   * math:
   *   \R: \mathbb{R}
   *   \N: \mathbb{N}
   *   \norm: \left\lVert #1 \right\rVert
   * ```
   */
  math?: Record<string, string>;
  /**
   * Folder for storing images relative to the document.
   * When set, paste/drop/insert image operations save files here
   * instead of using data URLs.
   * Example: "assets" → images saved to `assets/image-name.png`
   */
  imageFolder?: string;
}

export interface FrontmatterResult {
  /** Parsed configuration, or empty object if no frontmatter found. */
  config: FrontmatterConfig;
  /** Character offset where the frontmatter ends (after closing ---\n). -1 if none. */
  end: number;
  /** Structured parse status for diagnostics. */
  status: FrontmatterStatus;
}

export type FrontmatterStatus =
  | { readonly state: "missing" }
  | { readonly state: "ok"; readonly end: number }
  | {
    readonly state: "error";
    readonly kind: "parse";
    readonly message: string;
    readonly from: number;
    readonly to: number;
  };

/**
 * Extract the raw YAML text between `---` delimiters at the start of a document.
 * Returns null if no frontmatter is present.
 */
function findLineBoundary(
  doc: string,
  from: number,
): { lineEnd: number; next: number } {
  const lineFeed = doc.indexOf("\n", from);
  if (lineFeed === -1) {
    return { lineEnd: doc.length, next: doc.length };
  }
  const lineEnd = lineFeed > from && doc[lineFeed - 1] === "\r" ? lineFeed - 1 : lineFeed;
  return { lineEnd, next: lineFeed + 1 };
}

export function isFrontmatterDelimiterLine(line: string): boolean {
  return line.slice(0, 3) === "---" && line.slice(3).trim().length === 0;
}

function isStandaloneDelimiter(
  doc: string,
  from: number,
  lineEnd: number,
): boolean {
  return isFrontmatterDelimiterLine(doc.slice(from, lineEnd));
}

export function extractRawFrontmatter(
  doc: string,
): { raw: string; end: number } | null {
  if (!doc.startsWith("---")) return null;

  const opening = findLineBoundary(doc, 0);
  if (opening.next === doc.length) return null;
  if (!isStandaloneDelimiter(doc, 0, opening.lineEnd)) return null;

  let lineStart = opening.next;
  while (lineStart < doc.length) {
    const line = findLineBoundary(doc, lineStart);
    if (isStandaloneDelimiter(doc, lineStart, line.lineEnd)) {
      let rawEnd = lineStart;
      if (rawEnd > opening.next && doc[rawEnd - 1] === "\n") {
        rawEnd -= 1;
        if (rawEnd > opening.next && doc[rawEnd - 1] === "\r") {
          rawEnd -= 1;
        }
      }
      return {
        raw: doc.slice(opening.next, rawEnd),
        end: line.next,
      };
    }
    if (line.next === doc.length) break;
    lineStart = line.next;
  }

  return null;
}

/** Type guard for plain non-array objects from parsed YAML. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Invalid YAML frontmatter";
}

/** Convert a raw record to a typed BlockConfig, picking only known fields. */
function toBlockConfig(raw: Record<string, unknown>): BlockConfig {
  const config: BlockConfig = {};
  // counter: string → use that group; null → explicitly remove group;
  // absent/undefined → inherit from built-in (not set on config).
  if (typeof raw["counter"] === "string") config.counter = raw["counter"];
  else if (raw["counter"] === null) config.counter = null;
  if (typeof raw["numbered"] === "boolean") config.numbered = raw["numbered"];
  if (typeof raw["title"] === "string") config.title = raw["title"];
  return config;
}

/**
 * Validate and convert a raw `blocks` object from YAML into typed block config.
 */
function validateBlocks(
  raw: Record<string, unknown>,
): Record<string, boolean | BlockConfig> {
  const blocks: Record<string, boolean | BlockConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "boolean") {
      blocks[name] = value;
    } else if (isRecord(value)) {
      blocks[name] = toBlockConfig(value);
    } else {
      // Invalid scalar in blocks section — warn and ignore it so malformed
      // frontmatter cannot silently enable or override a block.
      const valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      console.warn(
        `[frontmatter] blocks.${name}: expected boolean or mapping, got ${valueType}. Ignoring entry.`,
      );
    }
  }
  return blocks;
}

/**
 * Validate and convert a raw `math` object from YAML into string key-value pairs.
 */
function validateMath(raw: Record<string, unknown>): Record<string, string> {
  const math: Record<string, string> = {};
  for (const [macro, expansion] of Object.entries(raw)) {
    if (typeof expansion === "string") {
      math[macro] = expansion;
    }
  }
  return math;
}

/**
 * Parse YAML frontmatter from a document string into a typed config.
 *
 * Uses the standard `yaml` npm package for parsing. The `extractRawFrontmatter`
 * function handles `---` boundary detection, then `YAML.parse()` handles the
 * actual YAML parsing — correctly handling quoted keys, escape sequences, etc.
 *
 * Returns the parsed config and the character offset where the frontmatter
 * ends. If no frontmatter is found, returns an empty config and end = -1.
 */
export function parseFrontmatter(doc: string): FrontmatterResult {
  const extracted = extractRawFrontmatter(doc);
  if (!extracted) {
    return { config: {}, end: -1, status: { state: "missing" } };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(extracted.raw);
  } catch (error: unknown) {
    // Frontmatter is parsed on every keystroke, so malformed YAML is expected
    // while editing. Degrade to empty config and let diagnostics surface it.
    return {
      config: {},
      end: extracted.end,
      status: {
        state: "error",
        kind: "parse",
        message: errorMessage(error),
        from: 0,
        to: extracted.end,
      },
    };
  }

  if (!isRecord(parsed)) {
    return { config: {}, end: extracted.end, status: { state: "ok", end: extracted.end } };
  }

  const raw = parsed;
  const config: FrontmatterConfig = {};

  // String fields
  for (const key of ["title", "bibliography", "csl"] as const) {
    if (typeof raw[key] === "string") config[key] = raw[key] as string;
  }

  // LaTeX export options.
  const latex = raw["latex"];
  if (isRecord(latex)) {
    const latexConfig: NonNullable<FrontmatterConfig["latex"]> = {};
    if (typeof latex["bibliography"] === "string") {
      latexConfig.bibliography = latex["bibliography"];
    }
    if (typeof latex["template"] === "string") {
      latexConfig.template = latex["template"];
    }
    if (Object.keys(latexConfig).length > 0) {
      config.latex = latexConfig;
    }
  }

  // Numbering enum
  const numbering = raw["numbering"];
  if (numbering === "global" || numbering === "grouped") {
    config.numbering = numbering;
  }

  // Image folder (support both kebab-case and camelCase)
  const imageFolder = raw["image-folder"] ?? raw["imageFolder"];
  if (typeof imageFolder === "string") config.imageFolder = imageFolder;

  // Blocks section
  const blocks = raw["blocks"];
  if (isRecord(blocks)) {
    const validated = validateBlocks(blocks);
    if (Object.keys(validated).length > 0) {
      config.blocks = validated;
    }
  }

  // Math macros section
  const math = raw["math"];
  if (isRecord(math)) {
    const validated = validateMath(math);
    if (Object.keys(validated).length > 0) {
      config.math = validated;
    }
  }

  return { config, end: extracted.end, status: { state: "ok", end: extracted.end } };
}
