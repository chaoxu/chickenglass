import { describe, expect, it } from "vitest";

import {
  coflatMarkdownNodes as facadeNodes,
  coflatMarkdownTransformers as facadeTransformers,
  lexicalMarkdownTheme as facadeTheme,
} from "./markdown";
import { coflatMarkdownNodes, lexicalMarkdownTheme } from "./markdown-schema";
import { coflatMarkdownTransformers } from "./markdown-transformers";

describe("lexical markdown module boundaries", () => {
  it("keeps the markdown facade as a compatibility layer over explicit owners", () => {
    expect(facadeNodes).toBe(coflatMarkdownNodes);
    expect(facadeTheme).toBe(lexicalMarkdownTheme);
    expect(facadeTransformers).toBe(coflatMarkdownTransformers);
  });
});
