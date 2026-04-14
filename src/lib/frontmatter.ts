import { parse as parseYaml } from "yaml";

/** Frontmatter fence — three hyphens, optional trailing whitespace, end of line. */
export const FRONTMATTER_DELIMITER = "---";
export const FRONTMATTER_DELIMITER_RE = /^---\s*$/;

export interface BlockConfig {
  counter?: string | null;
  numbered?: boolean;
  title?: string;
}

export type NumberingScheme = "global" | "grouped";

export interface FrontmatterConfig {
  title?: string;
  bibliography?: string;
  csl?: string;
  numbering?: NumberingScheme;
  blocks?: Record<string, boolean | BlockConfig>;
  math?: Record<string, string>;
  imageFolder?: string;
}

export interface FrontmatterResult {
  config: FrontmatterConfig;
  end: number;
}

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
  return (
    doc.slice(from, from + FRONTMATTER_DELIMITER.length) === FRONTMATTER_DELIMITER &&
    doc.slice(from + FRONTMATTER_DELIMITER.length, lineEnd).trim().length === 0
  );
}

function extractRawFrontmatter(
  doc: string,
): { raw: string; end: number } | null {
  if (!doc.startsWith(FRONTMATTER_DELIMITER)) return null;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBlockConfig(raw: Record<string, unknown>): BlockConfig {
  const config: BlockConfig = {};
  if (typeof raw["counter"] === "string") config.counter = raw["counter"];
  else if (raw["counter"] === null) config.counter = null;
  if (typeof raw["numbered"] === "boolean") config.numbered = raw["numbered"];
  if (typeof raw["title"] === "string") config.title = raw["title"];
  return config;
}

function validateBlocks(
  raw: Record<string, unknown>,
): Record<string, boolean | BlockConfig> {
  const blocks: Record<string, boolean | BlockConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "boolean") {
      blocks[name] = value;
    } else if (isRecord(value)) {
      blocks[name] = toBlockConfig(value);
    }
  }
  return blocks;
}

function validateMath(raw: Record<string, unknown>): Record<string, string> {
  const math: Record<string, string> = {};
  for (const [macro, expansion] of Object.entries(raw)) {
    if (typeof expansion === "string") {
      math[macro] = expansion;
    }
  }
  return math;
}

export function parseFrontmatter(doc: string): FrontmatterResult {
  const extracted = extractRawFrontmatter(doc);
  if (!extracted) {
    return { config: {}, end: -1 };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(extracted.raw);
  } catch {
    return { config: {}, end: extracted.end };
  }

  if (!isRecord(parsed)) {
    return { config: {}, end: extracted.end };
  }

  const raw = parsed;
  const config: FrontmatterConfig = {};

  for (const key of ["title", "bibliography", "csl"] as const) {
    if (typeof raw[key] === "string") config[key] = raw[key] as string;
  }

  const numbering = raw["numbering"];
  if (numbering === "global" || numbering === "grouped") {
    config.numbering = numbering;
  }

  const imageFolder = raw["image-folder"] ?? raw["imageFolder"];
  if (typeof imageFolder === "string") config.imageFolder = imageFolder;

  const blocks = raw["blocks"];
  if (isRecord(blocks)) {
    const validated = validateBlocks(blocks);
    if (Object.keys(validated).length > 0) {
      config.blocks = validated;
    }
  }

  const math = raw["math"];
  if (isRecord(math)) {
    const validated = validateMath(math);
    if (Object.keys(validated).length > 0) {
      config.math = validated;
    }
  }

  return { config, end: extracted.end };
}
