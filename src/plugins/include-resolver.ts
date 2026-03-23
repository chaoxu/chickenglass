import type { FileSystem } from "../lib/types";
import { resolveProjectPathFromDocument } from "../lib/project-paths";

/** A single resolved include: the file path and its content. */
export interface ResolvedInclude {
  /** The file path that was included. */
  readonly path: string;
  /** The markdown content of the included file. */
  readonly content: string;
  /** Nested includes found within this file (recursively resolved). */
  readonly children: readonly ResolvedInclude[];
}

/** Error produced when an include cycle is detected. */
export class IncludeCycleError extends Error {
  /** The chain of file paths forming the cycle. */
  readonly chain: readonly string[];

  constructor(chain: readonly string[]) {
    const cycle = chain.join(" -> ");
    super(`Include cycle detected: ${cycle}`);
    this.name = "IncludeCycleError";
    this.chain = chain;
  }
}

/** Error produced when an included file cannot be found. */
export class IncludeNotFoundError extends Error {
  /** The path that could not be resolved. */
  readonly path: string;

  constructor(path: string) {
    super(`Included file not found: ${path}`);
    this.name = "IncludeNotFoundError";
    this.path = path;
  }
}

/**
 * Pattern matching `::: {.include} <path> :::` blocks in markdown.
 *
 * Captures the file path from the content between the opening and closing fence.
 * Supports both single-line and multi-line forms:
 *   - Single line: `::: {.include} chapter1.md :::`
 *   - Multi-line:
 *     ```
 *     ::: {.include}
 *     chapter1.md
 *     :::
 *     ```
 */
const INCLUDE_BLOCK_RE =
  /^:{3,}\s*\{\.include\}\s*\n?\s*(.+?)\s*\n?\s*:{3,}\s*$/gm;

/**
 * Pattern matching fenced code blocks (triple-backtick or triple-tilde).
 * Used to exclude include directives that appear inside code blocks.
 */
const FENCED_CODE_BLOCK_RE = /^(`{3,}|~{3,}).*\n[\s\S]*?^\1\s*$/gm;

/**
 * Compute the character ranges covered by fenced code blocks.
 * Returns sorted, non-overlapping `[from, to)` intervals.
 */
function fencedCodeRanges(
  content: string,
): readonly { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const re = new RegExp(FENCED_CODE_BLOCK_RE.source, FENCED_CODE_BLOCK_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

/** Check whether a position falls inside any of the given ranges. */
function insideCodeBlock(
  pos: number,
  ranges: readonly { from: number; to: number }[],
): boolean {
  for (const r of ranges) {
    if (pos >= r.from && pos < r.to) return true;
    // Ranges are sorted, so we can bail early once we pass the position.
    if (r.from > pos) break;
  }
  return false;
}

/**
 * Run INCLUDE_BLOCK_RE against `content` and return only those matches
 * that do NOT fall inside a fenced code block.
 */
function matchIncludesOutsideCodeBlocks(
  content: string,
): RegExpExecArray[] {
  const codeRanges = fencedCodeRanges(content);
  const re = new RegExp(INCLUDE_BLOCK_RE.source, INCLUDE_BLOCK_RE.flags);
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (!insideCodeBlock(match.index, codeRanges)) {
      matches.push(match);
    }
  }
  return matches;
}

/** Extract include paths from markdown content, ignoring code blocks. */
export function extractIncludePaths(content: string): readonly string[] {
  const paths: string[] = [];
  for (const match of matchIncludesOutsideCodeBlocks(content)) {
    const path = match[1].trim();
    if (path.length > 0) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Resolve a file path relative to a base file's directory.
 *
 * If `includePath` is absolute (starts with `/`), it is returned as-is.
 * Otherwise it is resolved relative to the directory of `fromPath`.
 */
export function resolveIncludePath(
  fromPath: string,
  includePath: string,
): string {
  return resolveProjectPathFromDocument(fromPath, includePath);
}

/**
 * Recursively resolve all includes starting from a root file.
 *
 * @param rootPath - The path of the root document.
 * @param fs - The filesystem to read files from.
 * @returns The resolved include tree.
 * @throws {IncludeCycleError} If a cycle is detected in the include chain.
 * @throws {IncludeNotFoundError} If an included file does not exist.
 */
export async function resolveIncludes(
  rootPath: string,
  fs: FileSystem,
): Promise<readonly ResolvedInclude[]> {
  return resolveIncludesRecursive(rootPath, fs, []);
}

async function resolveIncludesRecursive(
  filePath: string,
  fs: FileSystem,
  ancestorChain: readonly string[],
): Promise<readonly ResolvedInclude[]> {
  // Include filePath itself in the chain so self-referential includes (A -> A)
  // are detected immediately without reading the file a second time.
  const selfChain = [...ancestorChain, filePath];

  const content = await readFileChecked(filePath, fs);
  const includePaths = extractIncludePaths(content);

  const results: ResolvedInclude[] = [];
  for (const rawPath of includePaths) {
    const resolved = resolveIncludePath(filePath, rawPath);

    // Cycle detection: check if this path appears in the ancestor chain
    if (selfChain.includes(resolved)) {
      throw new IncludeCycleError([...selfChain, resolved]);
    }

    const childContent = await readFileChecked(resolved, fs);

    // Recursively resolve nested includes, passing selfChain so the current
    // file is part of the ancestry for all descendants.
    const children = await resolveIncludesRecursive(resolved, fs, selfChain);

    results.push({
      path: resolved,
      content: childContent,
      children,
    });
  }

  return results;
}

async function readFileChecked(path: string, fs: FileSystem): Promise<string> {
  const fileExists = await fs.exists(path);
  if (!fileExists) {
    throw new IncludeNotFoundError(path);
  }
  return fs.readFile(path);
}

/**
 * Flatten the include tree into a linear sequence of file contents,
 * in the order they should appear in the merged document.
 *
 * Each included file's content replaces its include directive.
 * Nested includes are expanded inline.
 */
export function flattenIncludes(
  rootContent: string,
  includes: readonly ResolvedInclude[],
): string {
  if (includes.length === 0) {
    return rootContent;
  }

  let result = rootContent;
  let includeIndex = 0;
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const match of matchIncludesOutsideCodeBlocks(result)) {
    if (includeIndex >= includes.length) break;

    const include = includes[includeIndex];
    // Recursively flatten nested includes
    const expandedContent = flattenIncludes(include.content, include.children);

    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      text: expandedContent,
    });
    includeIndex++;
  }

  // Apply replacements in reverse order to preserve offsets
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }

  return result;
}

/** Result of flattening includes with source-map tracking. */
export interface FlattenResult {
  /** The fully expanded document text. */
  text: string;
  /** Regions mapping positions in the expanded text to source files. */
  regions: Array<{ from: number; to: number; file: string; originalRef: string; rawFrom: number; rawTo: number }>;
}

/**
 * Flatten includes like `flattenIncludes`, but also track where each
 * included file's content ends up in the expanded document.
 */
export function flattenIncludesWithSourceMap(
  rootContent: string,
  includes: readonly ResolvedInclude[],
): FlattenResult {
  if (includes.length === 0) {
    return { text: rootContent, regions: [] };
  }

  let includeIndex = 0;
  const replacements: Array<{
    start: number;
    end: number;
    text: string;
    file: string;
    originalRef: string;
  }> = [];

  for (const match of matchIncludesOutsideCodeBlocks(rootContent)) {
    if (includeIndex >= includes.length) break;

    const include = includes[includeIndex];
    const expandedContent = flattenIncludes(include.content, include.children);

    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      text: expandedContent,
      file: include.path,
      originalRef: match[0],
    });
    includeIndex++;
  }

  // Build result and regions by applying replacements forward
  const regions: FlattenResult["regions"] = [];
  let result = "";
  let cursor = 0;
  let offset = 0; // cumulative shift from replacements

  for (const r of replacements) {
    // Copy text before this replacement
    result += rootContent.slice(cursor, r.start);
    const newFrom = r.start + offset;
    result += r.text;
    const newTo = newFrom + r.text.length;

    regions.push({
      from: newFrom,
      to: newTo,
      file: r.file,
      originalRef: r.originalRef,
      rawFrom: r.start,
      rawTo: r.end,
    });

    offset += r.text.length - (r.end - r.start);
    cursor = r.end;
  }
  result += rootContent.slice(cursor);

  return { text: result, regions };
}

/**
 * Collect all file paths in the include tree (depth-first).
 * Useful for determining what files are part of the merged document.
 */
export function collectIncludedPaths(
  includes: readonly ResolvedInclude[],
): readonly string[] {
  const paths: string[] = [];
  for (const inc of includes) {
    paths.push(inc.path);
    paths.push(...collectIncludedPaths(inc.children));
  }
  return paths;
}
