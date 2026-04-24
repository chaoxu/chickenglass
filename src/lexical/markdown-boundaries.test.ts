import { describe, expect, it } from "vitest";

import { DOCUMENT_SURFACE_CLASS } from "../document-surface-classes";
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

  it("maps Lexical semantic nodes onto the shared document surface contract", () => {
    expect(lexicalMarkdownTheme.paragraph).toContain(DOCUMENT_SURFACE_CLASS.paragraph);
    expect(lexicalMarkdownTheme.quote).toContain(DOCUMENT_SURFACE_CLASS.blockquote);
    expect(lexicalMarkdownTheme.heading?.h1).toContain(DOCUMENT_SURFACE_CLASS.heading);
    expect(lexicalMarkdownTheme.heading?.h1).toContain(DOCUMENT_SURFACE_CLASS.headingLevel(1));
    expect(lexicalMarkdownTheme.list?.ul).toContain(DOCUMENT_SURFACE_CLASS.listUnordered);
    expect(lexicalMarkdownTheme.list?.ol).toContain(DOCUMENT_SURFACE_CLASS.listOrdered);
    expect(lexicalMarkdownTheme.list?.listitem).toContain(DOCUMENT_SURFACE_CLASS.listItem);
    expect(lexicalMarkdownTheme.link).toContain(DOCUMENT_SURFACE_CLASS.link);
    expect(lexicalMarkdownTheme.code).toContain(DOCUMENT_SURFACE_CLASS.codeBlock);
  });
});
