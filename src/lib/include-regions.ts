import {
  StateEffect,
  StateField,
  type ChangeSet,
} from "@codemirror/state";

export interface IncludeRegionState {
  readonly from: number;
  readonly to: number;
  readonly file: string;
}

export const setIncludeRegionsEffect = StateEffect.define<readonly IncludeRegionState[]>();

function mapRegion(
  region: IncludeRegionState,
  changes: ChangeSet,
): IncludeRegionState {
  const from = changes.mapPos(region.from, -1);
  const to = Math.max(from, changes.mapPos(region.to, 1));
  if (from === region.from && to === region.to) {
    return region;
  }
  return {
    ...region,
    from,
    to,
  };
}

export const includeRegionsField = StateField.define<readonly IncludeRegionState[]>({
  create() {
    return [];
  },

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setIncludeRegionsEffect)) {
        return effect.value;
      }
    }

    if (!tr.docChanged || value.length === 0) {
      return value;
    }

    const next = value.map((region) => mapRegion(region, tr.changes));
    if (next.every((region, index) => region === value[index])) {
      return value;
    }
    return next;
  },
});
