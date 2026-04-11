export function parseMarkdownImage(raw: string): { alt: string; src: string } | null {
  const match = raw.trim().match(/^!\[([^\]]*)\]\(([^)\n]+)\)\s*$/);
  if (!match) {
    return null;
  }
  return {
    alt: match[1],
    src: match[2].trim(),
  };
}
