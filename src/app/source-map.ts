import type { ChangeSet } from "@codemirror/state";

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

/** Tracks which parts of a composed document belong to which source files. */
export class SourceMap {
  constructor(public regions: IncludeRegion[]) {}

  /** Update all region positions through a CM6 ChangeSet. */
  mapThrough(changes: ChangeSet): void {
    for (const region of this.regions) {
      const newFrom = changes.mapPos(region.from, -1);
      const newTo = changes.mapPos(region.to, 1);
      region.from = newFrom;
      // If the region was fully deleted, keep it as an empty region
      region.to = Math.max(newFrom, newTo);
    }
  }

  /** Find which file owns a given position (null = main file). */
  fileAt(pos: number): string | null {
    const region = this.regionAt(pos);
    return region ? region.file : null;
  }

  /** Get the region containing a position (null = main file). */
  regionAt(pos: number): IncludeRegion | null {
    // Binary search through sorted regions
    let lo = 0;
    let hi = this.regions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const region = this.regions[mid];
      if (pos < region.from) {
        hi = mid - 1;
      } else if (pos >= region.to) {
        lo = mid + 1;
      } else {
        // pos >= region.from && pos < region.to
        return region;
      }
    }
    return null;
  }

  /** Extract each included file's content from the composed document. */
  decompose(doc: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const region of this.regions) {
      const content = doc.substring(region.from, region.to);
      const existing = result.get(region.file);
      if (existing !== undefined && existing !== content) {
        throw new ConflictingIncludeContentError(region.file);
      }
      result.set(region.file, content);
    }
    return result;
  }

  /** Reconstruct the main file with include references restored. */
  reconstructMain(doc: string, _mainFile: string): string {
    const parts: string[] = [];
    let cursor = 0;
    for (const region of this.regions) {
      // Text before this region belongs to the main file
      parts.push(doc.substring(cursor, region.from));
      // Replace the region content with the original include reference
      parts.push(region.originalRef);
      cursor = region.to;
    }
    // Text after the last region belongs to the main file
    parts.push(doc.substring(cursor));
    return parts.join("");
  }
}
