import { createHeadlessEditor } from "@lexical/headless";
import { $createHeadingNode, $isHeadingNode, HeadingNode } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot, ParagraphNode, TextNode } from "lexical";
import { describe, expect, it } from "vitest";

import { $collectHeadingEntries } from "./heading-index-plugin";

function createTestEditor() {
  return createHeadlessEditor({
    namespace: "coflat-heading-index-test",
    nodes: [HeadingNode, ParagraphNode, TextNode],
    onError(error) {
      throw error;
    },
  });
}

describe("$collectHeadingEntries", () => {
  it("extracts headings with correct levels and numbering", () => {
    const editor = createTestEditor();
    let result: ReturnType<typeof $collectHeadingEntries> = [];

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("Intro"));
      root.append(h1);

      root.append($createParagraphNode());

      const h2a = $createHeadingNode("h2");
      h2a.append($createTextNode("Methods"));
      root.append(h2a);

      const h2b = $createHeadingNode("h2");
      h2b.append($createTextNode("Results"));
      root.append(h2b);

      result = $collectHeadingEntries();
    }, { discrete: true });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ level: 1, text: "Intro", number: "1" });
    expect(result[1]).toMatchObject({ level: 2, text: "Methods", number: "1.1" });
    expect(result[2]).toMatchObject({ level: 2, text: "Results", number: "1.2" });
  });

  it("handles unnumbered headings without advancing counters", () => {
    const editor = createTestEditor();
    let result: ReturnType<typeof $collectHeadingEntries> = [];

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("One"));
      root.append(h1);

      const h2a = $createHeadingNode("h2");
      h2a.append($createTextNode("Sub A"));
      root.append(h2a);

      const h2u = $createHeadingNode("h2");
      h2u.append($createTextNode("Aside {-}"));
      root.append(h2u);

      const h2b = $createHeadingNode("h2");
      h2b.append($createTextNode("Sub B"));
      root.append(h2b);

      result = $collectHeadingEntries();
    }, { discrete: true });

    expect(result).toHaveLength(4);
    expect(result[2]).toMatchObject({ text: "Aside", number: "" });
    expect(result[3]).toMatchObject({ text: "Sub B", number: "1.2" });
  });

  it("extracts Pandoc heading ids from attributes", () => {
    const editor = createTestEditor();
    let result: ReturnType<typeof $collectHeadingEntries> = [];

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("Intro {#sec:intro}"));
      root.append(h1);

      result = $collectHeadingEntries();
    }, { discrete: true });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ text: "Intro", id: "sec:intro" });
  });

  it("returns empty array when there are no headings", () => {
    const editor = createTestEditor();
    let result: ReturnType<typeof $collectHeadingEntries> = [];

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      root.append($createParagraphNode());

      result = $collectHeadingEntries();
    }, { discrete: true });

    expect(result).toEqual([]);
  });

  it("resets deeper counters when a higher-level heading appears", () => {
    const editor = createTestEditor();
    let result: ReturnType<typeof $collectHeadingEntries> = [];

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1a = $createHeadingNode("h1");
      h1a.append($createTextNode("Chapter 1"));
      root.append(h1a);

      const h2 = $createHeadingNode("h2");
      h2.append($createTextNode("Section"));
      root.append(h2);

      const h1b = $createHeadingNode("h1");
      h1b.append($createTextNode("Chapter 2"));
      root.append(h1b);

      const h2b = $createHeadingNode("h2");
      h2b.append($createTextNode("Another Section"));
      root.append(h2b);

      result = $collectHeadingEntries();
    }, { discrete: true });

    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ number: "1" });
    expect(result[1]).toMatchObject({ number: "1.1" });
    expect(result[2]).toMatchObject({ number: "2" });
    expect(result[3]).toMatchObject({ number: "2.1" });
  });

  it("reflects heading text updates", () => {
    const editor = createTestEditor();
    let result1: ReturnType<typeof $collectHeadingEntries> = [];
    let result2: ReturnType<typeof $collectHeadingEntries> = [];

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("Original"));
      root.append(h1);

      result1 = $collectHeadingEntries();
    }, { discrete: true });

    expect(result1[0]).toMatchObject({ text: "Original" });

    editor.update(() => {
      const root = $getRoot();
      const heading = root.getChildren().find($isHeadingNode);
      if (heading) {
        heading.getFirstChild()?.remove();
        heading.append($createTextNode("Updated"));
      }

      result2 = $collectHeadingEntries();
    }, { discrete: true });

    expect(result2[0]).toMatchObject({ text: "Updated" });
  });

  it("reflects heading removal", () => {
    const editor = createTestEditor();
    let result1: ReturnType<typeof $collectHeadingEntries> = [];
    let result2: ReturnType<typeof $collectHeadingEntries> = [];

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const h1 = $createHeadingNode("h1");
      h1.append($createTextNode("Keep"));
      root.append(h1);

      const h2 = $createHeadingNode("h2");
      h2.append($createTextNode("Remove"));
      root.append(h2);

      result1 = $collectHeadingEntries();
    }, { discrete: true });

    expect(result1).toHaveLength(2);

    editor.update(() => {
      const root = $getRoot();
      const headings = root.getChildren().filter($isHeadingNode);
      headings[1]?.remove();

      result2 = $collectHeadingEntries();
    }, { discrete: true });

    expect(result2).toHaveLength(1);
    expect(result2[0]).toMatchObject({ text: "Keep" });
  });
});
