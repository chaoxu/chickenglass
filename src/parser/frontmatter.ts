/**
 * Lightweight YAML frontmatter parser for Coflat documents.
 *
 * Parses the subset of YAML used in document frontmatter:
 * flat string keys, boolean values, and one level of nested objects.
 */

export interface BlockConfig {
  counter?: string;
  numbered?: boolean;
  title?: string;
}

/** How numbered blocks are counted across the document. */
export type NumberingScheme = "global" | "grouped";

export interface FrontmatterConfig {
  title?: string;
  bibliography?: string;
  csl?: string;
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
}

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

function isStandaloneDelimiter(
  doc: string,
  from: number,
  lineEnd: number,
): boolean {
  return doc.slice(from, from + 3) === "---" && doc.slice(from + 3, lineEnd).trim().length === 0;
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

/** Remove surrounding quotes and process YAML escape sequences. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === "'" && last === "'") {
      return value.slice(1, -1);
    }
    if (first === '"' && last === '"') {
      // Double-quoted YAML strings interpret escape sequences
      return value.slice(1, -1).replace(/\\(.)/g, (_m, ch: string) => {
        if (ch === "n") return "\n";
        if (ch === "t") return "\t";
        return ch; // \\ → \, \" → ", etc.
      });
    }
  }
  return value;
}

/** Parse a scalar YAML value into a string or boolean. */
function parseScalar(raw: string): string | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return unquote(trimmed);
}

/** Count leading spaces in a line. */
function indentLevel(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === " ") count++;
    else break;
  }
  return count;
}

/** Check if a line should be skipped (blank or comment). */
function isSkippable(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/**
 * Parse a simple subset of YAML from lines, starting at index `start`.
 *
 * Collects `key: value` pairs where indentation > `minIndent`.
 * Returns the parsed record and the index after the last consumed line.
 */
function parseIndentedBlock(
  lines: string[],
  start: number,
  minIndent: number,
): { entries: Record<string, string | boolean>; nextIndex: number } {
  const entries: Record<string, string | boolean> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isSkippable(line)) {
      i++;
      continue;
    }
    if (indentLevel(line) <= minIndent) break;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      i++;
      continue;
    }
    entries[line.slice(0, colonIndex).trim()] = parseScalar(
      line.slice(colonIndex + 1),
    );
    i++;
  }
  return { entries, nextIndex: i };
}

/** Convert a raw record to a typed BlockConfig. */
function toBlockConfig(raw: Record<string, string | boolean>): BlockConfig {
  const config: BlockConfig = {};
  if (typeof raw["counter"] === "string") config.counter = raw["counter"];
  if (typeof raw["numbered"] === "boolean") config.numbered = raw["numbered"];
  if (typeof raw["title"] === "string") config.title = raw["title"];
  return config;
}

/**
 * Parse the `blocks:` section supporting both simple booleans and nested configs.
 */
function parseBlocksSection(
  lines: string[],
  start: number,
  sectionIndent: number,
): { blocks: Record<string, boolean | BlockConfig>; nextIndex: number } {
  const blocks: Record<string, boolean | BlockConfig> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isSkippable(line)) {
      i++;
      continue;
    }

    const lineIndent = indentLevel(line);
    if (lineIndent <= sectionIndent) break;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const blockName = line.slice(0, colonIndex).trim();
    const valueRaw = line.slice(colonIndex + 1).trim();

    if (valueRaw !== "") {
      const parsed = parseScalar(valueRaw);
      if (typeof parsed === "boolean") {
        blocks[blockName] = parsed;
      } else {
        // Non-boolean scalar in blocks section — coerce truthy string to true
        // and warn so authors can fix their frontmatter.
        console.warn(
          `[frontmatter] blocks.${blockName}: expected boolean, got "${valueRaw}". Treating as true.`,
        );
        blocks[blockName] = true;
      }
      i++;
    } else {
      // Nested config: collect sub-keys with deeper indentation
      const { entries, nextIndex } = parseIndentedBlock(
        lines,
        i + 1,
        lineIndent,
      );
      blocks[blockName] = toBlockConfig(entries);
      i = nextIndex;
    }
  }

  return { blocks, nextIndex: i };
}

/**
 * Parse YAML frontmatter from a document string into a typed config.
 *
 * Returns the parsed config and the character offset where the frontmatter
 * ends. If no frontmatter is found, returns an empty config and end = -1.
 */
export function parseFrontmatter(doc: string): FrontmatterResult {
  const extracted = extractRawFrontmatter(doc);
  if (!extracted) {
    return { config: {}, end: -1 };
  }

  const lines = extracted.raw.split("\n");
  const config: FrontmatterConfig = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isSkippable(line)) {
      i++;
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const valueRaw = line.slice(colonIndex + 1).trim();

    if (key === "title" && valueRaw !== "") {
      const parsed = parseScalar(valueRaw);
      if (typeof parsed === "string") config.title = parsed;
      i++;
    } else if (key === "bibliography" && valueRaw !== "") {
      const parsed = parseScalar(valueRaw);
      if (typeof parsed === "string") config.bibliography = parsed;
      i++;
    } else if (key === "csl" && valueRaw !== "") {
      const parsed = parseScalar(valueRaw);
      if (typeof parsed === "string") config.csl = parsed;
      i++;
    } else if (key === "numbering" && valueRaw !== "") {
      if (valueRaw === "global" || valueRaw === "grouped") {
        config.numbering = valueRaw;
      }
      i++;
    } else if (key === "blocks" && valueRaw === "") {
      const result = parseBlocksSection(lines, i + 1, indentLevel(line));
      if (Object.keys(result.blocks).length > 0) {
        config.blocks = result.blocks;
      }
      i = result.nextIndex;
    } else if ((key === "image-folder" || key === "imageFolder") && valueRaw !== "") {
      const parsed = parseScalar(valueRaw);
      if (typeof parsed === "string") config.imageFolder = parsed;
      i++;
    } else if (key === "math" && valueRaw === "") {
      const { entries, nextIndex } = parseIndentedBlock(
        lines,
        i + 1,
        indentLevel(line),
      );
      const math: Record<string, string> = {};
      for (const [macro, expansion] of Object.entries(entries)) {
        if (typeof expansion === "string") {
          math[macro] = expansion;
        }
      }
      if (Object.keys(math).length > 0) {
        config.math = math;
      }
      i = nextIndex;
    } else {
      // Unknown key: skip, including any nested block
      if (valueRaw === "") {
        i++;
        while (i < lines.length && !isSkippable(lines[i]) && indentLevel(lines[i]) > indentLevel(line)) {
          i++;
        }
      } else {
        i++;
      }
    }
  }

  return { config, end: extracted.end };
}
