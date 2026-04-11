import { describe, expect, it } from "vitest";

import { parseMarkdownImage } from "./image-markdown";

describe("parseMarkdownImage", () => {
  it("parses markdown image syntax", () => {
    expect(parseMarkdownImage("![Preview](images/example.png)")).toEqual({
      alt: "Preview",
      src: "images/example.png",
    });
  });

  it("rejects malformed image markdown", () => {
    expect(parseMarkdownImage("[Preview](images/example.png)")).toBeNull();
  });
});
