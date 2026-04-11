import { describe, expect, it } from "vitest";

import { buildDocumentRuntime } from "./document-runtime";
import { createLexicalRenderResourceResolver } from "./resource-resolver";
import { MemoryFileSystem } from "../../app/file-manager";

describe("buildDocumentRuntime", () => {
  it("builds pure document-derived render state outside React", () => {
    const resolver = createLexicalRenderResourceResolver(new MemoryFileSystem(), "notes/main.md");
    const runtime = buildDocumentRuntime([
      "---",
      "title: Local Title",
      "bibliography: refs/local.bib",
      "math:",
      "  \"\\\\NN\": \"\\\\mathbb{N}\"",
      "---",
      "",
      "::: {.theorem #thm:main}",
      "Body",
      ":::",
      "",
      "See [^proof].",
      "",
      "[^proof]: First line",
      "  Second line",
    ].join("\n"), {
      bibliography: "refs/project.bib",
      blocks: {
        theorem: {
          title: "Result",
        },
      },
      math: {
        "\\RR": "\\mathbb{R}",
      },
    }, resolver);

    expect(runtime.config).toEqual({
      bibliography: "refs/local.bib",
      blocks: {
        theorem: {
          title: "Result",
        },
      },
      math: {
        "\\NN": "\\mathbb{N}",
        "\\RR": "\\mathbb{R}",
      },
      title: "Local Title",
    });
    expect(runtime.renderIndex.references.get("thm:main")?.label).toBe("Result 1");
    expect(runtime.footnoteDefinitions.get("proof")).toBe("First line\nSecond line");
    expect(runtime.labelGraph.uniqueDefinitionById.get("thm:main")?.id).toBe("thm:main");
    expect(runtime.resolveAssetUrl("images/example.png")).toBe("/demo/notes/images/example.png");
  });
});
