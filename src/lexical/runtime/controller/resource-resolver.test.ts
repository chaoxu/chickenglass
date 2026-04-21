import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../../../app/file-manager";
import { createLexicalRenderResourceResolver } from "./resource-resolver";

describe("createLexicalRenderResourceResolver", () => {
  it("reads document-relative resource candidates before project-root fallbacks", async () => {
    const resolver = createLexicalRenderResourceResolver(new MemoryFileSystem({
      "notes/main.md": "# Main",
      "notes/refs/library.bib": "local bibliography",
      "refs/library.bib": "root bibliography",
    }), "notes/main.md");

    await expect(resolver.readProjectTextFile("refs/library.bib")).resolves.toBe("local bibliography");
  });

  it("falls back to the project root when the document-relative resource is missing", async () => {
    const resolver = createLexicalRenderResourceResolver(new MemoryFileSystem({
      "notes/main.md": "# Main",
      "refs/library.bib": "root bibliography",
    }), "notes/main.md");

    await expect(resolver.readProjectTextFile("refs/library.bib")).resolves.toBe("root bibliography");
  });

});
