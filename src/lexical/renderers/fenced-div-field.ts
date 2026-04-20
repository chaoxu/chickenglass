import {
  parseStructuredFencedDivRaw,
  serializeFencedDivRaw,
} from "../markdown/block-syntax";

type FencedDivFieldOverrides = NonNullable<Parameters<typeof serializeFencedDivRaw>[1]>;

export function getFirstLine(raw: string): string {
  return raw.split("\n")[0] ?? "";
}

export function replaceFirstLine(raw: string, nextFirstLine: string): string {
  const lines = raw.split("\n");
  lines[0] = nextFirstLine;
  return lines.join("\n");
}

export function updateFencedDivField(
  currentRaw: string,
  overrides: FencedDivFieldOverrides,
): string {
  return serializeFencedDivRaw(parseStructuredFencedDivRaw(currentRaw), overrides);
}
