export interface ReferenceClusterParts {
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export interface ReferenceClusterItem {
  readonly id: string;
  readonly locator?: string;
  readonly markerFrom: number;
  readonly markerTo: number;
}

export const REFERENCE_ID_SOURCE = "[A-Za-z0-9_][\\w:./'-]*\\w|[A-Za-z0-9_]";
export const BRACKETED_REFERENCE_BODY_SOURCE =
  `@(?:${REFERENCE_ID_SOURCE})(?:,[^;\\]\\n]*)?(?:\\s*;\\s*@(?:${REFERENCE_ID_SOURCE})(?:,[^;\\]\\n]*)?)*`;

export const BRACKETED_REFERENCE_GLOBAL_RE = new RegExp(
  `\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]`,
  "g",
);
export const BRACKETED_REFERENCE_IMPORT_RE = new RegExp(
  `\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]`,
);
export const BRACKETED_REFERENCE_SHORTCUT_RE = new RegExp(
  `\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]$`,
);
export const BRACKETED_REFERENCE_EXACT_RE = new RegExp(
  `^\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]$`,
);
export const NARRATIVE_REFERENCE_GLOBAL_RE = new RegExp(
  `(?<![[@\\w])@(${REFERENCE_ID_SOURCE})(?![\\w@/'-])`,
  "g",
);
export const NARRATIVE_REFERENCE_IMPORT_RE = new RegExp(
  `(?<![[@\\w])@(${REFERENCE_ID_SOURCE})(?![\\w@/'-])`,
);
export const NARRATIVE_REFERENCE_SHORTCUT_RE = new RegExp(
  `(?<![[@\\w])@(${REFERENCE_ID_SOURCE})(?![\\w@/'-])$`,
);
export const NARRATIVE_REFERENCE_EXACT_RE = new RegExp(
  `^@(?:${REFERENCE_ID_SOURCE})$`,
);

const REFERENCE_CLUSTER_ITEM_RE = new RegExp(
  `@(${REFERENCE_ID_SOURCE})(?:,([^;\\]\\n]*))?`,
  "y",
);

function normalizeLocator(locator: string): string | undefined {
  return (
    locator
      .replace(/^[\s;,:-]+|[\s;,:-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

export function parseReferenceClusterBody(raw: string): readonly ReferenceClusterItem[] | null {
  const items: ReferenceClusterItem[] = [];
  let pos = 0;

  while (pos < raw.length) {
    REFERENCE_CLUSTER_ITEM_RE.lastIndex = pos;
    const match = REFERENCE_CLUSTER_ITEM_RE.exec(raw);
    if (!match) {
      return null;
    }

    const markerFrom = pos;
    const id = match[1] ?? "";
    const markerTo = markerFrom + 1 + id.length;
    const locator = match[2] === undefined ? undefined : normalizeLocator(match[2]);
    items.push({
      id,
      locator,
      markerFrom,
      markerTo,
    });

    pos = REFERENCE_CLUSTER_ITEM_RE.lastIndex;
    while (raw[pos] === " " || raw[pos] === "\t") {
      pos += 1;
    }
    if (pos >= raw.length) {
      break;
    }
    if (raw[pos] !== ";") {
      return null;
    }
    pos += 1;
    while (raw[pos] === " " || raw[pos] === "\t") {
      pos += 1;
    }
  }

  return items.length > 0 ? items : null;
}

export function extractReferenceCluster(raw: string): ReferenceClusterParts {
  const parts = parseReferenceClusterBody(raw);
  if (!parts) {
    return { ids: [], locators: [] };
  }

  return {
    ids: parts.map((part) => part.id),
    locators: parts.map((part) => part.locator),
  };
}
