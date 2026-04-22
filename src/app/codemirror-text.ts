import type { Text } from "@codemirror/state";

export function normalizeCmTextString(text: string): string {
  if (!text.includes("\r")) {
    return text;
  }
  return text.replace(/\r\n?/g, "\n");
}

export function textMatchesString(doc: Text, text: string): boolean {
  if (doc.length !== text.length) {
    return false;
  }

  let offset = 0;
  const cursor = doc.iter();
  while (!cursor.next().done) {
    const value = cursor.value;
    if (text.slice(offset, offset + value.length) !== value) {
      return false;
    }
    offset += value.length;
  }

  return offset === text.length;
}
