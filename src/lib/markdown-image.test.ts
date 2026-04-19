import { describe, expect, it } from "vitest";

import {
  classifyAssetTarget,
  isMarkdownImageLine,
  parseMarkdownImage,
} from "./markdown-image";

describe("markdown image syntax", () => {
  it("parses markdown image alt text and targets", () => {
    expect(parseMarkdownImage("![Preview](images/example.png)")).toEqual({
      alt: "Preview",
      src: "images/example.png",
    });
    expect(parseMarkdownImage("  ![Alt text](figures/paper.pdf?download=1#page=2)  ")).toEqual({
      alt: "Alt text",
      src: "figures/paper.pdf?download=1#page=2",
    });
  });

  it("rejects invalid markdown image text", () => {
    expect(parseMarkdownImage("[Preview](images/example.png)")).toBeNull();
    expect(parseMarkdownImage("![Preview]()")).toBeNull();
    expect(isMarkdownImageLine("Before ![Preview](image.png)")).toBe(false);
  });

  it.each([
    ["images/example.png", "local", true, false],
    ["/images/example.png", "absolute-path", false, false],
    ["C:\\images\\example.png", "absolute-path", false, false],
    ["https://example.com/image.png", "protocol-url", false, false],
    ["//cdn.example.com/image.png", "protocol-relative-url", false, false],
    ["data:image/png;base64,abc", "data-url", false, false],
    ["figures/paper.pdf?download=1#page=2", "local", true, true],
  ] as const)("classifies asset target %s", (target, kind, isLocal, isPdf) => {
    expect(classifyAssetTarget(target)).toMatchObject({ kind, isLocal, isPdf });
  });
});
