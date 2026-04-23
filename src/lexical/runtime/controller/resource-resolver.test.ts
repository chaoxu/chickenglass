import { describe, expect, it } from "vitest";

import { createLexicalRenderResourceResolver } from "./resource-resolver";

function createTextFileReader(files: Record<string, string>) {
  return {
    async readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`missing file: ${path}`);
      }
      return content;
    },
  };
}

describe("createLexicalRenderResourceResolver", () => {
  it("reads document-relative resource candidates before project-root fallbacks", async () => {
    const resolver = createLexicalRenderResourceResolver(createTextFileReader({
      "notes/main.md": "# Main",
      "notes/refs/library.bib": "local bibliography",
      "refs/library.bib": "root bibliography",
    }), "notes/main.md");

    await expect(resolver.readProjectTextFile("refs/library.bib")).resolves.toBe("local bibliography");
  });

  it("falls back to the project root when the document-relative resource is missing", async () => {
    const resolver = createLexicalRenderResourceResolver(createTextFileReader({
      "notes/main.md": "# Main",
      "refs/library.bib": "root bibliography",
    }), "notes/main.md");

    await expect(resolver.readProjectTextFile("refs/library.bib")).resolves.toBe("root bibliography");
  });

});
