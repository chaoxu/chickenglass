/**
 * Load blog project files at build time via Vite's import.meta.glob.
 * Files live in demo/blog/ as real .md/.yaml/.bib/.csl files.
 */

const mdFiles = import.meta.glob("/demo/blog/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const yamlFiles = import.meta.glob("/demo/blog/**/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const bibFiles = import.meta.glob("/demo/blog/**/*.bib", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const cslFiles = import.meta.glob("/demo/blog/**/*.csl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const rootMarkdownFiles = import.meta.glob("/FORMAT.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Strip the "/demo/blog/" prefix so paths are relative to the blog project root. */
function stripPrefix(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const relative = path.replace(/^\/demo\/blog\//, "");
    result[relative] = content;
  }
  return result;
}

/** All blog project files as a flat Record<relativePath, content>. */
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
