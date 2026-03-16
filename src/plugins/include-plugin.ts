import type { FileSystem } from "../app/file-manager";
import {
  type ResolvedInclude,
  IncludeCycleError,
  IncludeNotFoundError,
  resolveIncludes,
  flattenIncludes,
  collectIncludedPaths,
} from "./include-resolver";

/** Block numbering state: maps block class to its current counter. */
export type BlockCounters = Map<string, number>;

/** A numbered block found in content. */
export interface NumberedBlock {
  /** The class of the block (e.g., "theorem", "lemma"). */
  readonly blockClass: string;
  /** The id of the block, if any. */
  readonly id: string | undefined;
  /** The assigned number. */
  readonly number: number;
}

/**
 * Pattern matching numbered fenced div blocks.
 * Captures: class name and optional id.
 *
 * Matches blocks like:
 *   ::: {.theorem #thm:main}
 *   ...
 *   :::
 */
const NUMBERED_BLOCK_RE =
  /^:{3,}\s*\{\.(\w[\w-]*)\s*(?:#([\w:.:-]+))?\s*(?:[^}]*)?\}/gm;

/** Classes that should be numbered. */
const NUMBERED_CLASSES = new Set([
  "theorem",
  "lemma",
  "proposition",
  "corollary",
  "definition",
  "example",
  "remark",
  "conjecture",
  "claim",
  "fact",
  "observation",
  "axiom",
]);

/** Check if a block class should receive a number. */
export function isNumberedClass(blockClass: string): boolean {
  return NUMBERED_CLASSES.has(blockClass);
}

/**
 * Extract numbered blocks from content, assigning numbers
 * starting from the given counters.
 *
 * Mutates `counters` to reflect the final state after processing.
 */
export function extractNumberedBlocks(
  content: string,
  counters: BlockCounters,
): readonly NumberedBlock[] {
  const blocks: NumberedBlock[] = [];
  const re = new RegExp(NUMBERED_BLOCK_RE.source, NUMBERED_BLOCK_RE.flags);

  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const blockClass = match[1];
    const id = match[2] as string | undefined;

    if (!isNumberedClass(blockClass)) continue;

    const current = counters.get(blockClass) ?? 0;
    const nextNumber = current + 1;
    counters.set(blockClass, nextNumber);

    blocks.push({ blockClass, id, number: nextNumber });
  }

  return blocks;
}

/** A cross-reference target discovered in the document. */
export interface RefTarget {
  /** The id used for referencing (e.g., "thm:main"). */
  readonly id: string;
  /** The display label (e.g., "Theorem 1"). */
  readonly label: string;
  /** The source file where this target was defined. */
  readonly sourcePath: string;
}

/**
 * Build a reference map from numbered blocks across all files.
 *
 * The map keys are block ids, values are display labels like "Theorem 1".
 */
export function buildRefMap(
  blocks: readonly NumberedBlock[],
  sourcePath: string,
): readonly RefTarget[] {
  const targets: RefTarget[] = [];
  for (const block of blocks) {
    if (block.id !== undefined) {
      const label = capitalize(block.blockClass) + " " + String(block.number);
      targets.push({ id: block.id, label, sourcePath });
    }
  }
  return targets;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Result of processing a document with includes. */
export interface IncludeResult {
  /** The merged document content with includes expanded inline. */
  readonly mergedContent: string;
  /** All numbered blocks across the merged document. */
  readonly numberedBlocks: readonly NumberedBlock[];
  /** Map of reference id to display label, for cross-reference resolution. */
  readonly refMap: ReadonlyMap<string, RefTarget>;
  /** All file paths included (in order). */
  readonly includedPaths: readonly string[];
}

/** Error information when include processing fails. */
export interface IncludeError {
  /** The type of error. */
  readonly type: "cycle" | "not-found" | "unknown";
  /** Human-readable error message. */
  readonly message: string;
  /** The file path involved in the error (if applicable). */
  readonly path?: string;
}

/**
 * Process a root document, resolving all includes and building
 * a merged document with continuous numbering and cross-references.
 *
 * @param rootPath - Path of the root document.
 * @param rootContent - Content of the root document.
 * @param fs - Filesystem for reading included files.
 * @returns The processed result or an error.
 */
export async function processIncludes(
  rootPath: string,
  rootContent: string,
  fs: FileSystem,
): Promise<IncludeResult | IncludeError> {
  try {
    const includes = await resolveIncludes(rootPath, fs);
    const mergedContent = flattenIncludes(rootContent, includes);
    const includedPaths = [...collectIncludedPaths(includes)];

    // Number all blocks across the merged document with continuous counters.
    // This single pass produces correct sequential numbers.
    const counters: BlockCounters = new Map();
    const numberedBlocks = extractNumberedBlocks(mergedContent, counters);

    // Build reference map with source-path tracking.
    // Walk root + each included file in order with shared counters
    // so numbers match the merged-document pass above.
    const refMap = new Map<string, RefTarget>();
    const perFileCounters: BlockCounters = new Map();

    const fileSequence: ReadonlyArray<{ content: string; path: string }> = [
      { content: rootContent, path: rootPath },
      ...flattenIncludeTree(includes).map((inc) => ({
        content: inc.content,
        path: inc.path,
      })),
    ];

    for (const file of fileSequence) {
      const blocks = extractNumberedBlocks(file.content, perFileCounters);
      for (const target of buildRefMap(blocks, file.path)) {
        refMap.set(target.id, target);
      }
    }

    return { mergedContent, numberedBlocks, refMap, includedPaths };
  } catch (error: unknown) {
    if (error instanceof IncludeCycleError) {
      return { type: "cycle", message: error.message, path: error.chain[error.chain.length - 1] };
    }
    if (error instanceof IncludeNotFoundError) {
      return { type: "not-found", message: error.message, path: error.path };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { type: "unknown", message: msg };
  }
}

/** Check if a result is an error. */
export function isIncludeError(
  result: IncludeResult | IncludeError,
): result is IncludeError {
  return "type" in result;
}

/** Flatten the include tree into a linear list (depth-first). */
function flattenIncludeTree(
  includes: readonly ResolvedInclude[],
): readonly ResolvedInclude[] {
  const result: ResolvedInclude[] = [];
  for (const inc of includes) {
    result.push(inc);
    result.push(...flattenIncludeTree(inc.children));
  }
  return result;
}
