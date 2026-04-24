export const HEADING_SOURCE_CLASS = "cf-lexical-heading";

export const SOURCE_POSITION_DATASET = {
  headingNumber: "coflatHeadingNumber",
  headingPos: "coflatHeadingPos",
  rawBlock: "coflatRawBlock",
  rawBlockFallback: "coflatRawBlockFallback",
  rawBlockVariant: "coflatRawBlockVariant",
  sourceBlock: "coflatSourceBlock",
  sourceBlockKind: "coflatSourceBlockKind",
  sourceFrom: "coflatSourceFrom",
  sourceTo: "coflatSourceTo",
  tableBlock: "coflatTableBlock",
  tableColumns: "coflatTableColumns",
  sourceBlockNodeKey: "coflatSourceBlockNodeKey",
} as const;

export const SOURCE_POSITION_ATTR = {
  headingPos: "data-coflat-heading-pos",
  rawBlock: "data-coflat-raw-block",
  rawBlockFallback: "data-coflat-raw-block-fallback",
  rawBlockVariant: "data-coflat-raw-block-variant",
  sourceFrom: "data-coflat-source-from",
  sourceTo: "data-coflat-source-to",
  tableBlock: "data-coflat-table-block",
  sourceBlockNodeKey: "data-coflat-source-block-node-key",
} as const;

export const RAW_BLOCK_SOURCE_SELECTOR = `[${SOURCE_POSITION_ATTR.rawBlock}='true']`;
export const TABLE_BLOCK_SOURCE_SELECTOR = `[${SOURCE_POSITION_ATTR.tableBlock}='true']`;
export const SOURCE_BLOCK_SELECTOR = `${RAW_BLOCK_SOURCE_SELECTOR}, ${TABLE_BLOCK_SOURCE_SELECTOR}`;
export const HEADING_SOURCE_SELECTOR = `.${HEADING_SOURCE_CLASS}[${SOURCE_POSITION_ATTR.headingPos}]`;
export const SOURCE_POSITION_SELECTOR = `[${SOURCE_POSITION_ATTR.sourceFrom}], ${HEADING_SOURCE_SELECTOR}`;

export function rawBlockSourceAttrs(variant: string, fallback = false): Record<string, string> {
  return {
    [SOURCE_POSITION_ATTR.rawBlock]: "true",
    [SOURCE_POSITION_ATTR.rawBlockVariant]: variant,
    ...(fallback ? { [SOURCE_POSITION_ATTR.rawBlockFallback]: "true" } : {}),
  };
}

export function markTableSourceBlock(
  element: HTMLElement,
  columnCount: number,
): void {
  element.dataset[SOURCE_POSITION_DATASET.sourceBlock] = "true";
  element.dataset[SOURCE_POSITION_DATASET.sourceBlockKind] = "table";
  element.dataset[SOURCE_POSITION_DATASET.tableBlock] = "true";
  element.dataset[SOURCE_POSITION_DATASET.tableColumns] = String(columnCount);
}

export function clearSourceRange(element: HTMLElement): void {
  delete element.dataset[SOURCE_POSITION_DATASET.sourceFrom];
  delete element.dataset[SOURCE_POSITION_DATASET.sourceTo];
}

export function setSourceRange(element: HTMLElement, from: number, to: number): void {
  element.dataset[SOURCE_POSITION_DATASET.sourceFrom] = String(from);
  element.dataset[SOURCE_POSITION_DATASET.sourceTo] = String(to);
}

export function readSourceFrom(element: HTMLElement): number | null {
  const sourceFrom = element.dataset[SOURCE_POSITION_DATASET.sourceFrom];
  if (sourceFrom === undefined) {
    return null;
  }
  const parsed = Number(sourceFrom);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readSourceTo(element: HTMLElement): number | null {
  const sourceTo = element.dataset[SOURCE_POSITION_DATASET.sourceTo];
  if (sourceTo === undefined) {
    return null;
  }
  const parsed = Number(sourceTo);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readHeadingSourcePos(element: HTMLElement): number | null {
  const headingPos = element.dataset[SOURCE_POSITION_DATASET.headingPos];
  if (headingPos === undefined) {
    return null;
  }
  const parsed = Number(headingPos);
  return Number.isFinite(parsed) ? parsed : null;
}
