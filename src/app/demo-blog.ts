/**
 * Load demo project files at build time via Vite's import.meta.glob.
 * Files live in demo/ as real .md/.yaml/.bib/.csl files.
 */

const mdFiles = import.meta.glob("/demo/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const yamlFiles = import.meta.glob("/demo/**/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const bibFiles = import.meta.glob("/demo/**/*.bib", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const cslFiles = import.meta.glob("/demo/**/*.csl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const rootMarkdownFiles = import.meta.glob("/FORMAT.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Strip the "/demo/" prefix so paths are relative to the demo project root. */
function stripPrefix(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const relative = path.replace(/^\/demo\//, "");
    result[relative] = content;
  }
  return result;
}

/** All demo project files as a flat Record<relativePath, content>. */
export function getBlogFiles(): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(rootMarkdownFiles).map(([path, content]) => [
        path.replace(/^\//, ""),
        content,
      ]),
    ),
    ...stripPrefix(yamlFiles),
    ...stripPrefix(bibFiles),
    ...stripPrefix(cslFiles),
    ...stripPrefix(mdFiles),
  };
}
