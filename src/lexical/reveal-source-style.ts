export const REVEAL_SOURCE_STYLE_PROPERTY = "--cf-reveal";

export const REVEAL_SOURCE_TEXT_STYLE = [
  `${REVEAL_SOURCE_STYLE_PROPERTY}:1`,
  "font-family:var(--cf-code-font)",
  "font-size:14px",
].join(";");

export function isRevealSourceStyle(style: string): boolean {
  return style.includes(REVEAL_SOURCE_STYLE_PROPERTY);
}
