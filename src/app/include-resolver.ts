import type { FileSystem } from "./file-manager";
import { type IncludeRegion, SourceMap } from "./source-map";
import { extractMarkdownBlocks } from "./markdown/labels";
import { maskMarkdownCodeSpansAndBlocks } from "./markdown/masking";
import {
  normalizeProjectPath,
  resolveProjectPathFromDocument,
} from "../lib/project-paths";

export interface ResolvedInclude {
  readonly path: string;
  readonly content: string;
  readonly children: readonly ResolvedInclude[];
}

export class IncludeCycleError extends Error {
  readonly chain: readonly string[];

  constructor(chain: readonly string[]) {
    super(`Include cycle detected: ${chain.join(" -> ")}`);
    this.name = "IncludeCycleError";
    this.chain = chain;
  }
}

export class IncludeNotFoundError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Included file not found: ${path}`);
    this.name = "IncludeNotFoundError";
    this.path = path;
  }
}

interface IncludeMatch {
  readonly from: number;
  readonly path: string;
  readonly text: string;
  readonly to: number;
}

interface FlattenRegion {
  readonly children: readonly FlattenRegion[];
  readonly file: string;
  readonly from: number;
  readonly originalRef: string;
  readonly rawFrom: number;
  readonly rawTo: number;
  readonly to: number;
}

interface IncludeExpansionResult {
  readonly regions: readonly FlattenRegion[];
  readonly text: string;
}

interface CacheEntry {
  readonly fileContents: ReadonlyMap<string, string>;
  readonly result: IncludeExpansionResult;
  readonly rootContent: string;
}

function findIncludeBlocks(content: string): readonly IncludeMatch[] {
  return extractMarkdownBlocks(content, maskMarkdownCodeSpansAndBlocks(content))
    .filter((block) => block.blockType === "include")
    .map((block) => ({
      from: block.from,
      path: block.content.trim(),
      text: content.slice(block.from, block.to),
      to: block.to,
    }))
    .filter((block) => block.path.length > 0);
}

function resolveIncludePath(fromPath: string, includePath: string): string {
  return resolveProjectPathFromDocument(fromPath, includePath);
}

async function readFileChecked(path: string, fs: FileSystem): Promise<string> {
  const normalized = normalizeProjectPath(path);
  const exists = await fs.exists(normalized);
  if (!exists) {
    throw new IncludeNotFoundError(normalized);
  }
  return fs.readFile(normalized);
}

async function resolveIncludesCore(
  filePath: string,
  content: string,
  fs: FileSystem,
  ancestorChain: readonly string[],
): Promise<readonly ResolvedInclude[]> {
  const selfChain = [...ancestorChain, filePath];
  const includeBlocks = findIncludeBlocks(content);
  const results: ResolvedInclude[] = [];

  for (const block of includeBlocks) {
    const resolvedPath = resolveIncludePath(filePath, block.path);
    if (selfChain.includes(resolvedPath)) {
      throw new IncludeCycleError([...selfChain, resolvedPath]);
    }

    const childContent = await readFileChecked(resolvedPath, fs);
    const children = await resolveIncludesCore(resolvedPath, childContent, fs, selfChain);
    results.push({
      children,
      content: childContent,
      path: resolvedPath,
    });
  }

  return results;
}

export async function resolveIncludesFromContent(
  filePath: string,
  content: string,
  fs: FileSystem,
): Promise<readonly ResolvedInclude[]> {
  return resolveIncludesCore(normalizeProjectPath(filePath), content, fs, []);
}

function offsetRegions(regions: readonly FlattenRegion[], base: number): FlattenRegion[] {
  return regions.map((region) => ({
    ...region,
    from: region.from + base,
    to: region.to + base,
    children: offsetRegions(region.children, base),
  }));
}

function flattenIncludesWithSourceMap(
  rootContent: string,
  includes: readonly ResolvedInclude[],
): IncludeExpansionResult {
  if (includes.length === 0) {
    return { text: rootContent, regions: [] };
  }

  let includeIndex = 0;
  const replacements: Array<{
    readonly end: number;
    readonly file: string;
    readonly nestedRegions: readonly FlattenRegion[];
    readonly originalRef: string;
    readonly start: number;
    readonly text: string;
  }> = [];

  for (const block of findIncludeBlocks(rootContent)) {
    if (includeIndex >= includes.length) {
      break;
    }
    const include = includes[includeIndex];
    const nested = flattenIncludesWithSourceMap(include.content, include.children);
    replacements.push({
      end: block.to,
      file: include.path,
      nestedRegions: nested.regions,
      originalRef: block.text,
      start: block.from,
      text: nested.text,
    });
    includeIndex += 1;
  }

  const regions: FlattenRegion[] = [];
  let cursor = 0;
  let offset = 0;
  let result = "";

  for (const replacement of replacements) {
    result += rootContent.slice(cursor, replacement.start);
    const from = replacement.start + offset;
    result += replacement.text;
    const to = from + replacement.text.length;
    regions.push({
      children: offsetRegions(replacement.nestedRegions, from),
      file: replacement.file,
      from,
      originalRef: replacement.originalRef,
      rawFrom: replacement.start,
      rawTo: replacement.end,
      to,
    });
    offset += replacement.text.length - (replacement.end - replacement.start);
    cursor = replacement.end;
  }

  result += rootContent.slice(cursor);
  return { text: result, regions };
}

function collectFileContents(
  includes: readonly ResolvedInclude[],
  out: Map<string, string>,
): void {
  for (const include of includes) {
    out.set(include.path, include.content);
    collectFileContents(include.children, out);
  }
}

class IncludeExpansionCache {
  private readonly entries = new Map<string, CacheEntry>();

  async get(
    rootPath: string,
    rootContent: string,
    fs: FileSystem,
  ): Promise<IncludeExpansionResult | null> {
    const entry = this.entries.get(rootPath);
    if (!entry || entry.rootContent !== rootContent) {
      return null;
    }

    const validations = Array.from(entry.fileContents.entries()).map(async ([path, cached]) => {
      try {
        const exists = await fs.exists(path);
        if (!exists) {
          return false;
        }
        return (await fs.readFile(path)) === cached;
      } catch {
        return false;
      }
    });

    return (await Promise.all(validations)).every(Boolean)
      ? entry.result
      : null;
  }

  set(
    rootPath: string,
    rootContent: string,
    includes: readonly ResolvedInclude[],
    result: IncludeExpansionResult,
  ): void {
    const fileContents = new Map<string, string>();
    collectFileContents(includes, fileContents);
    this.entries.set(rootPath, {
      fileContents,
      result,
      rootContent,
    });
  }
}

const includeExpansionCache = new IncludeExpansionCache();

function cloneRegions(regions: readonly FlattenRegion[]): IncludeRegion[] {
  return regions.map((region) => ({
    children: cloneRegions(region.children),
    file: region.file,
    from: region.from,
    originalRef: region.originalRef,
    rawFrom: region.rawFrom,
    rawTo: region.rawTo,
    to: region.to,
  }));
}

export async function expandDocumentIncludes(
  mainPath: string,
  rawContent: string,
  fs: FileSystem,
): Promise<{ readonly sourceMap: SourceMap | null; readonly text: string }> {
  const cached = await includeExpansionCache.get(mainPath, rawContent, fs);
  if (cached) {
    const regions = cloneRegions(cached.regions);
    return {
      sourceMap: regions.length > 0 ? new SourceMap(regions) : null,
      text: cached.text,
    };
  }

  const includeBlocks = findIncludeBlocks(rawContent);
  if (includeBlocks.length === 0) {
    return {
      sourceMap: null,
      text: rawContent,
    };
  }

  try {
    const includes = await resolveIncludesFromContent(mainPath, rawContent, fs);
    const result = flattenIncludesWithSourceMap(rawContent, includes);
    includeExpansionCache.set(mainPath, rawContent, includes, result);
    const regions = cloneRegions(result.regions);
    return {
      sourceMap: regions.length > 0 ? new SourceMap(regions) : null,
      text: result.text,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[includes] expansion failed, falling back to raw content:", message);
    return {
      sourceMap: null,
      text: rawContent,
    };
  }
}
