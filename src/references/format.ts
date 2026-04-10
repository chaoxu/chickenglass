export function formatBlockReferenceLabel(
  displayTitle: string,
  number?: number,
): string {
  return number === undefined ? displayTitle : `${displayTitle} ${number}`;
}

export function formatEquationReferenceLabel(number: number | string): string {
  return `Eq. (${number})`;
}

export function formatHeadingReferenceLabel(
  heading: { readonly number: string; readonly text: string },
): string {
  return heading.number ? `Section ${heading.number}` : heading.text;
}
