import type { FileSystem } from "../lib/types";
import {
  normalizeProjectPath,
  resolveProjectPathFromDocument,
} from "../lib/project-paths";
import { analyzeMarkdownSemantics } from "../semantics/markdown-analysis";

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

/** A located include block: its position in the document and the path it references. */
interface IncludeMatch {
  /** Start of the entire fenced div block. */
  readonly from: number;
  /** End of the entire fenced div block. */
  readonly to: number;
  /** The include path extracted from the block body. */
  readonly path: string;
  /** The full original text of the include block. */
  readonly text: string;
}

/**
 * Adapt canonical include entries from DocumentAnalysis into the richer match
 * shape used by flattening and source-map generation.
 */
function findIncludeBlocks(content: string): readonly IncludeMatch[] {
  return analyzeMarkdownSemantics(content).includes.map((include) => ({
    from: include.from,
    to: include.to,
    path: include.path,
    text: content.slice(include.from, include.to),
  }));
}

/** Extract include paths from markdown content using canonical document analysis. */
export function extractIncludePaths(content: string): readonly string[] {
  return findIncludeBlocks(content).map((m) => m.path);
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
  const normalized = normalizeProjectPath(rootPath);
  const content = await readFileChecked(normalized, fs);
  return resolveIncludesCore(normalized, content, fs, []);
}

/**
 * Recursively resolve all includes found in the given content.
 *
 * Unlike {@link resolveIncludes}, this variant accepts already-loaded content
 * for the root file — useful when the caller has in-memory content that may
 * differ from what is on disk (e.g. the current editor buffer).
 *
 * @param filePath - The path of the document (used for relative-path resolution and cycle detection).
 * @param content - The markdown content to scan for include directives.
 * @param fs - The filesystem to read included files from.
 * @returns The resolved include tree.
 * @throws {IncludeCycleError} If a cycle is detected in the include chain.
 * @throws {IncludeNotFoundError} If an included file does not exist.
 */
export async function resolveIncludesFromContent(
  filePath: string,
  content: string,
  fs: FileSystem,
): Promise<readonly ResolvedInclude[]> {
  return resolveIncludesCore(normalizeProjectPath(filePath), content, fs, []);
}

async function resolveIncludesCore(
  filePath: string,
  content: string,
  fs: FileSystem,
  ancestorChain: readonly string[],
): Promise<readonly ResolvedInclude[]> {
  // Include filePath itself in the chain so self-referential includes (A -> A)
  // are detected immediately without reading the file a second time.
  const selfChain = [...ancestorChain, filePath];

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
    const children = await resolveIncludesCore(resolved, childContent, fs, selfChain);

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

  for (const block of findIncludeBlocks(result)) {
    if (includeIndex >= includes.length) break;

    const include = includes[includeIndex];
    // Recursively flatten nested includes
    const expandedContent = flattenIncludes(include.content, include.children);

    replacements.push({
      start: block.from,
      end: block.to,
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

/** A source-map region within a flattened document, potentially with nested children. */
export interface FlattenRegion {
  from: number;
  to: number;
  file: string;
  originalRef: string;
  rawFrom: number;
  rawTo: number;
  children: FlattenRegion[];
}

/** Result of flattening includes with source-map tracking. */
export interface FlattenResult {
  /** The fully expanded document text. */
  text: string;
  /** Regions mapping positions in the expanded text to source files. */
  regions: FlattenRegion[];
}

/** Recursively shift all region positions by a base offset. */
function offsetRegions(regions: FlattenRegion[], base: number): FlattenRegion[] {
  return regions.map((r) => ({
    ...r,
    from: r.from + base,
    to: r.to + base,
    children: offsetRegions(r.children, base),
  }));
}

/**
 * Flatten includes like `flattenIncludes`, but also track where each
 * included file's content ends up in the expanded document.
 *
 * Nested includes produce child regions so that each file's content
 * is correctly attributed in the source map.
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
    nestedRegions: FlattenRegion[];
  }> = [];

  for (const block of findIncludeBlocks(rootContent)) {
    if (includeIndex >= includes.length) break;

    const include = includes[includeIndex];
    // Recursively flatten child content and build nested source-map regions
    const nested = flattenIncludesWithSourceMap(include.content, include.children);

    replacements.push({
      start: block.from,
      end: block.to,
      text: nested.text,
      file: include.path,
      originalRef: block.text,
      nestedRegions: nested.regions,
    });
    includeIndex++;
  }

  // Build result and regions by applying replacements forward
  const regions: FlattenRegion[] = [];
  let result = "";
  let cursor = 0;
  let offset = 0; // cumulative shift from replacements

  for (const r of replacements) {
    // Copy text before this replacement
    result += rootContent.slice(cursor, r.start);
    const newFrom = r.start + offset;
    result += r.text;
    const newTo = newFrom + r.text.length;

    // Adjust nested region positions by the start of this replacement in output
    const children = offsetRegions(r.nestedRegions, newFrom);

    regions.push({
      from: newFrom,
      to: newTo,
      file: r.file,
      originalRef: r.originalRef,
      rawFrom: r.start,
      rawTo: r.end,
      children,
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

// ---------------------------------------------------------------------------
// Include expansion cache
// ---------------------------------------------------------------------------

/** Cached result of a full include expansion (resolve + flatten). */
export interface IncludeExpansionResult {
  readonly text: string;
  readonly regions: FlattenRegion[];
}

interface CacheEntry {
  readonly rootContent: string;
  /** Content of every transitively included file at cache-write time. */
  readonly fileContents: ReadonlyMap<string, string>;
  readonly result: IncludeExpansionResult;
}

function collectFileContents(
  includes: readonly ResolvedInclude[],
  out: Map<string, string>,
): void {
  for (const inc of includes) {
    out.set(inc.path, inc.content);
    collectFileContents(inc.children, out);
  }
}

/**
 * Cache for include expansion results.
 *
 * Keyed on root file path. A cache hit requires:
 * 1. The root content is identical (same include directives).
 * 2. Every transitively included file still has the same content on disk.
 *
 * Validation reads each included file in parallel but skips all Lezer
 * parsing, making a cache hit much cheaper than a full expansion.
 */
export class IncludeExpansionCache {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * Return a cached expansion result if the root content and all included
   * files are unchanged. Returns `null` on a cache miss.
   */
  async get(
    rootPath: string,
    rootContent: string,
    fs: FileSystem,
  ): Promise<IncludeExpansionResult | null> {
    const entry = this.entries.get(rootPath);
    if (!entry || entry.rootContent !== rootContent) return null;

    // Validate all included files in parallel.
    const checks = Array.from(entry.fileContents.entries()).map(
      async ([path, cached]): Promise<boolean> => {
        try {
          const exists = await fs.exists(path);
          if (!exists) return false;
          const current = await fs.readFile(path);
          return current === cached;
        } catch {
          return false;
        }
      },
    );

    if (!(await Promise.all(checks)).every(Boolean)) return null;
    return entry.result;
  }

  /** Store an expansion result in the cache. */
  set(
    rootPath: string,
    rootContent: string,
    includes: readonly ResolvedInclude[],
    result: IncludeExpansionResult,
  ): void {
    const fileContents = new Map<string, string>();
    collectFileContents(includes, fileContents);
    this.entries.set(rootPath, { rootContent, fileContents, result });
  }

  /** Remove all cached entries. */
  clear(): void {
    this.entries.clear();
  }
}
