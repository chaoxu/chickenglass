export interface RawChangedRange {
  readonly fromOld: number;
  readonly toOld: number;
  readonly fromNew: number;
  readonly toNew: number;
}

export interface DirtyWindow {
  readonly fromOld: number;
  readonly toOld: number;
  readonly fromNew: number;
  readonly toNew: number;
}

export interface SemanticDelta {
  readonly rawChangedRanges: readonly RawChangedRange[];
  readonly dirtyWindows: readonly DirtyWindow[];
  readonly docChanged: boolean;
  readonly syntaxTreeChanged: boolean;
  readonly frontmatterChanged: boolean;
  readonly globalInvalidation: boolean;
  mapOldToNew(pos: number, assoc?: number): number;
  mapNewToOld(pos: number, assoc?: number): number;
}
