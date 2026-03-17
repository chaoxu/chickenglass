/**
 * Include expansion and collapse for inline editing.
 *
 * When a document is opened, include blocks are expanded: the referenced
 * file's content is placed inside the fenced div so it can be edited
 * inline. On save, expanded include blocks are collapsed back to just
 * the path reference, and modified content is written to the source files.
 */

import type { FileSystem } from "./file-manager";
import { resolveIncludePath } from "../plugins/include-resolver";

/**
 * Pattern for expanded include blocks:
 *   ::: {.include} path.md
 *   <content>
 *   :::
 */
const EXPANDED_INCLUDE_RE =
  /^(:{3,})\s*\{\.include\}\s+(.+?)\s*\n([\s\S]*?)\n\1\s*$/gm;

/**
 * Pattern for collapsed include blocks (path only, no content):
 *   ::: {.include}
 *   path.md
 *   :::
 *
 * Also matches single-line: ::: {.include} path.md :::
 */
const COLLAPSED_INCLUDE_RE =
  /^(:{3,})\s*\{\.include\}\s*\n\s*(.+?)\s*\n\1\s*$/gm;

/** Info about an expanded include region in the document. */
export interface IncludeRegion {
  /** Full path of the included file. */
  readonly path: string;
  /** Content of the included file (as it appears in the editor). */
  readonly content: string;
}

/**
 * Expand include blocks in a document by loading referenced files.
 *
 * Transforms collapsed blocks:
 *   ::: {.include}
 *   chapter1.md
 *   :::
 *
 * Into expanded blocks:
 *   ::: {.include} chapter1.md
 *   <content of chapter1.md>
 *   :::
 *
 * @param content - The raw document content
 * @param docPath - Path of the document (for resolving relative paths)
 * @param fs - Filesystem to read included files
 * @returns The expanded document content
 */
export async function expandIncludes(
  content: string,
  docPath: string,
  fs: FileSystem,
): Promise<string> {
  const re = new RegExp(COLLAPSED_INCLUDE_RE.source, COLLAPSED_INCLUDE_RE.flags);
  const replacements: Array<{ from: number; to: number; replacement: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const colons = match[1];
    const rawPath = match[2].trim();
    const fullPath = resolveIncludePath(docPath, rawPath);

    try {
      const fileContent = await fs.readFile(fullPath);
      // Expanded form: path in title position, content inside fences
      const expanded = `${colons} {.include} ${rawPath}\n${fileContent}\n${colons}`;
      replacements.push({
        from: match.index,
        to: match.index + match[0].length,
        replacement: expanded,
      });
    } catch {
      // File not found — leave the block as-is
    }
  }

  // Apply replacements in reverse order to preserve positions
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { from, to, replacement } = replacements[i];
    result = result.slice(0, from) + replacement + result.slice(to);
  }

  return result;
}

/**
 * Collapse expanded include blocks back to path-only form and extract
 * the modified content for each included file.
 *
 * Transforms expanded blocks:
 *   ::: {.include} chapter1.md
 *   <modified content>
 *   :::
 *
 * Back to collapsed blocks:
 *   ::: {.include}
 *   chapter1.md
 *   :::
 *
 * @returns The collapsed document content and list of modified include regions
 */
export function collapseIncludes(content: string): {
  collapsed: string;
  regions: IncludeRegion[];
} {
  const regions: IncludeRegion[] = [];
  const re = new RegExp(EXPANDED_INCLUDE_RE.source, EXPANDED_INCLUDE_RE.flags);

  const collapsed = content.replace(re, (_full, colons: string, rawPath: string, innerContent: string) => {
    regions.push({
      path: rawPath.trim(),
      content: innerContent,
    });
    // Collapse back to path-only form
    return `${colons} {.include}\n${rawPath.trim()}\n${colons}`;
  });

  return { collapsed, regions };
}
