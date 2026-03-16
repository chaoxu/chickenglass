/**
 * Lightweight YAML frontmatter parser for chickenglass documents.
 *
 * Parses the subset of YAML used in document frontmatter:
 * flat string keys, boolean values, and one level of nested objects.
 */

export interface BlockConfig {
  counter?: string;
  numbered?: boolean;
  title?: string;
}

export interface FrontmatterConfig {
  title?: string;
  bibliography?: string;
  blocks?: Record<string, boolean | BlockConfig>;
  math?: Record<string, string>;
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
export function extractRawFrontmatter(
  doc: string,
): { raw: string; end: number } | null {
  if (!doc.startsWith("---")) return null;

  const firstNewline = doc.indexOf("\n");
  if (firstNewline === -1) return null;

  // Only whitespace allowed after opening ---
  if (doc.slice(3, firstNewline).trim().length > 0) return null;

  const closingIndex = doc.indexOf("\n---", firstNewline);
  if (closingIndex === -1) return null;

  const raw = doc.slice(firstNewline + 1, closingIndex);

  // end points past the closing --- and its newline (if present)
  let end = closingIndex + 4; // "\n---".length
  if (end < doc.length && doc[end] === "\n") {
    end += 1;
  }

  return { raw, end };
}

/** Remove surrounding quotes (single or double) from a YAML value. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
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
      blocks[blockName] = parseScalar(valueRaw) === true;
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
    } else if (key === "blocks" && valueRaw === "") {
      const result = parseBlocksSection(lines, i + 1, indentLevel(line));
      if (Object.keys(result.blocks).length > 0) {
        config.blocks = result.blocks;
      }
      i = result.nextIndex;
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
