/**
 * Load the public demo/showcase project files at build time via
 * Vite's import.meta.glob.
 *
 * Lazy variant: modules are loaded on first call to getDemoFiles(), not at
 * import time. This keeps the showcase corpus out of the initial bundle chunk.
 */

const mdLoaders = import.meta.glob("/demo/**/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const yamlLoaders = import.meta.glob("/demo/**/*.yaml", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const bibLoaders = import.meta.glob("/demo/**/*.bib", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const cslLoaders = import.meta.glob("/demo/**/*.csl", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const rootMarkdownLoaders = import.meta.glob("/FORMAT.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** Resolve all lazy loaders in a glob record into their string values. */
async function resolveLoaders(
  loaders: Record<string, () => Promise<string>>,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(loaders).map(async ([path, load]) => [path, await load()] as const),
  );
  return Object.fromEntries(entries);
}

/** Strip the "/demo/" prefix so paths are relative to the demo project root. */
function stripPrefix(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const relative = path.replace(/^\/demo\//, "");
    result[relative] = content;
  }
  return result;
}

/** All public demo project files as a flat Record<relativePath, content>. */
export async function getDemoFiles(): Promise<Record<string, string>> {
  const [mdFiles, yamlFiles, bibFiles, cslFiles, rootMarkdownFiles] =
    await Promise.all([
      resolveLoaders(mdLoaders),
      resolveLoaders(yamlLoaders),
      resolveLoaders(bibLoaders),
      resolveLoaders(cslLoaders),
      resolveLoaders(rootMarkdownLoaders),
    ]);

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
