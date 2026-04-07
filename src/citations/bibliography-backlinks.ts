import type { Text } from "@codemirror/state";
import type { CitationBacklink } from "./csl-processor";

const CITATION_BACKLINK_CONTEXT_MAX_LENGTH = 140;

export const COMPACT_CITATION_BACKLINK_TEXT = "↩";

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const headLength = Math.ceil((maxLength - 3) / 2);
  const tailLength = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, headLength)}...${text.slice(text.length - tailLength)}`;
}

function formatCitationBacklinkContext(lineNumber: number, lineText: string): string {
  const snippet = truncateMiddle(
    collapseWhitespace(lineText),
    CITATION_BACKLINK_CONTEXT_MAX_LENGTH,
  );
  return snippet.length > 0 ? `Line ${lineNumber}: ${snippet}` : `Line ${lineNumber}`;
}

export function buildCitationBacklinkContextFromDoc(
  doc: Text,
  backlink: Pick<CitationBacklink, "from">,
): string {
  const position = Math.max(0, Math.min(backlink.from, doc.length));
  const line = doc.lineAt(position);
  return formatCitationBacklinkContext(line.number, line.text);
}

export function buildCitationBacklinkContextFromText(
  text: string,
  backlink: Pick<CitationBacklink, "from">,
): string {
  const position = Math.max(0, Math.min(backlink.from, text.length));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < position; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    lineNumber += 1;
    lineStart = index + 1;
  }

  const nextLineBreak = text.indexOf("\n", position);
  const lineEnd = nextLineBreak >= 0 ? nextLineBreak : text.length;
  return formatCitationBacklinkContext(lineNumber, text.slice(lineStart, lineEnd));
}

export function buildCitationBacklinkAriaLabel(context: string): string {
  return `Jump to citation. ${context}`;
}
