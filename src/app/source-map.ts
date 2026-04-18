import type { EditorDocumentChange } from "../lib/editor-doc-change";

interface PositionMapping {
  mapPos: (pos: number, assoc?: number) => number;
}

/** A region of the composed document that belongs to an included file. */
export interface IncludeRegion {
  /** Start position in the composed document */
  from: number;
  /** End position in the composed document */
  to: number;
  /** Source file path */
  file: string;
  /** Original include reference text in the raw file */
  originalRef: string;
  /** Position of the include reference in the raw (unexpanded) file */
  rawFrom: number;
  /** End position of the include reference in the raw file */
  rawTo: number;
  /** Nested include regions within this region (for recursive includes). */
  children: IncludeRegion[];
}

/** Error produced when the same included file is edited inconsistently in multiple regions. */
export class ConflictingIncludeContentError extends Error {
  /** The duplicated include path with conflicting content. */
  readonly file: string;

  constructor(file: string) {
    super(`Included file has conflicting edited regions: ${file}`);
    this.name = "ConflictingIncludeContentError";
    this.file = file;
  }
}

/** Binary search for the most specific region containing `pos`. */
function searchRegion(regions: IncludeRegion[], pos: number): IncludeRegion | null {
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const region = regions[mid];
    if (pos < region.from) {
      hi = mid - 1;
    } else if (pos >= region.to) {
      lo = mid + 1;
    } else {
      // Found a match — check children for a deeper (more specific) match
      const child = searchRegion(region.children, pos);
      return child ?? region;
    }
  }
  return null;
}

/** Recursively update region positions through a position-mapping adapter. */
function mapRegionsThrough(regions: IncludeRegion[], changes: PositionMapping): void {
  for (const region of regions) {
    const newFrom = changes.mapPos(region.from, -1);
    const newTo = changes.mapPos(region.to, 1);
    region.from = newFrom;
    region.to = Math.max(newFrom, newTo);
    mapRegionsThrough(region.children, changes);
  }
}

/** Build a position mapping for sorted, non-overlapping editor document changes. */
export function createEditorDocumentChangePositionMapping(
  changes: readonly EditorDocumentChange[],
): PositionMapping {
  return {
    mapPos: (pos: number, assoc = 1): number => {
      let offset = 0;

      for (const change of changes) {
        if (pos < change.from) {
          break;
        }

        const insertedLength = change.insert.length;
        const deletedLength = change.to - change.from;

        if (pos > change.to) {
          offset += insertedLength - deletedLength;
          continue;
        }

        if (deletedLength === 0) {
          return change.from + offset + (assoc < 0 ? 0 : insertedLength);
        }

        if (pos === change.from) {
          return change.from + offset + (assoc < 0 ? 0 : insertedLength);
        }

        return change.from + offset + insertedLength;
      }

      return pos + offset;
    },
  };
}

/**
 * Recursively extract each included file's content from the composed document.
 *
 * For regions with children, the file's content is reconstructed by replacing
 * child spans with their original include directives.
 */
function decomposeRegions(
  doc: string,
  regions: IncludeRegion[],
  result: Map<string, string>,
): void {
  for (const region of regions) {
    decomposeRegions(doc, region.children, result);

    // Reconstruct this file's content: replace child spans with their originalRefs
    let content = "";
    let cursor = region.from;
    for (const child of region.children) {
      content += doc.substring(cursor, child.from);
      content += child.originalRef;
      cursor = child.to;
    }
    content += doc.substring(cursor, region.to);

    const existing = result.get(region.file);
    if (existing !== undefined && existing !== content) {
      throw new ConflictingIncludeContentError(region.file);
    }
    result.set(region.file, content);
  }
}

/** Tracks which parts of a composed document belong to which source files. */
export class SourceMap {
  constructor(public regions: IncludeRegion[]) {}

  /** Update all region positions through a position-mapping adapter. */
  mapThrough(changes: PositionMapping): void {
    mapRegionsThrough(this.regions, changes);
  }

  /** Find which file owns a given position (null = main file). */
  fileAt(pos: number): string | null {
    const region = this.regionAt(pos);
    return region ? region.file : null;
  }

  /** Get the most specific region containing a position (null = main file). */
  regionAt(pos: number): IncludeRegion | null {
    return searchRegion(this.regions, pos);
  }

  /** Extract each included file's content from the composed document. */
  decompose(doc: string): Map<string, string> {
    const result = new Map<string, string>();
    decomposeRegions(doc, this.regions, result);
    return result;
  }

  /** Reconstruct the main file with include references restored. */
  reconstructMain(doc: string, _mainFile: string): string {
    const parts: string[] = [];
    let cursor = 0;
    for (const region of this.regions) {
      parts.push(doc.substring(cursor, region.from));
      parts.push(region.originalRef);
      cursor = region.to;
    }
    parts.push(doc.substring(cursor));
    return parts.join("");
  }
}
