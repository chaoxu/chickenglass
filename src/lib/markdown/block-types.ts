export function normalizeBlockType(blockType: string | undefined, title: string | undefined): string {
  if (blockType) {
    return blockType;
  }
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    return "block";
  }
  return trimmedTitle.toLowerCase().replace(/\s+/g, "-");
}
