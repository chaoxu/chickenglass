const FOOTNOTE_DEFINITION_RE = /^\[\^([^\]]+)\]:\s*(.*)$/;

export function parseFootnoteDefinition(raw: string): { id: string; body: string } | null {
  const lines = raw.split("\n");
  const match = lines[0]?.match(FOOTNOTE_DEFINITION_RE);
  if (!match) {
    return null;
  }
  const bodyLines = [match[2], ...lines.slice(1).map((line) => line.replace(/^\s{2,4}/, ""))];
  return {
    id: match[1],
    body: bodyLines.join("\n").trim(),
  };
}

export function buildFootnoteDefinitionMap(doc: string): ReadonlyMap<string, string> {
  const definitions = new Map<string, string>();
  const lines = doc.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const match = line.match(FOOTNOTE_DEFINITION_RE);
    if (!match || definitions.has(match[1])) {
      continue;
    }

    let endLineIndex = lineIndex;
    for (let innerIndex = lineIndex + 1; innerIndex < lines.length; innerIndex += 1) {
      const innerLine = lines[innerIndex] ?? "";
      if (/^\s*$/.test(innerLine)) {
        break;
      }
      if (!/^\s{2,4}\S/.test(innerLine)) {
        break;
      }
      endLineIndex = innerIndex;
    }

    const parsed = parseFootnoteDefinition(lines.slice(lineIndex, endLineIndex + 1).join("\n"));
    if (parsed) {
      definitions.set(parsed.id, parsed.body);
      lineIndex = endLineIndex;
    }
  }

  return definitions;
}

export function serializeFootnoteDefinition(id: string, body: string): string {
  const lines = body.split("\n");
  const [firstLine = "", ...restLines] = lines;
  return [
    `[^${id}]: ${firstLine}`,
    ...restLines.map((line) => `  ${line}`),
  ].join("\n");
}
