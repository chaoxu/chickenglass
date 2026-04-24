/**
 * FORMAT.md regression suite.
 *
 * Verifies that every feature described in FORMAT.md is correctly parsed
 * and processed by the editor's state machinery (Lezer parser, semantics
 * analysis, block counter, plugin registry, frontmatter, cross-references).
 *
 * Tests operate on EditorState (no browser) via syntaxTree + state fields.
 * Visual rendering is out of scope — that belongs in the CDP suite.
 */

import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  collectEquationLabels,
  resolveCrossref,
} from "../index/crossref-resolver";
import { markdownExtensions } from "../parser";
import type { BlockPlugin } from "../plugins/plugin-types";
import { editorFocusField } from "../render/render-core";
import { blockCounterField } from "../state/block-counter";
import { documentSemanticsField } from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import { createPluginRegistryField } from "../state/plugin-registry";
import { createEditorState, makeBlockPlugin } from "../test-utils";
import { frontmatterField } from "./frontmatter-state";

// ── Test plugins (matching FORMAT.md built-in types) ─────────────────────────

const testPlugins: readonly BlockPlugin[] = [
  makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
  makeBlockPlugin({ name: "lemma", counter: "theorem", title: "Lemma" }),
  makeBlockPlugin({ name: "corollary", counter: "theorem", title: "Corollary" }),
  makeBlockPlugin({ name: "definition", title: "Definition" }),
  makeBlockPlugin({ name: "proof", numbered: false, title: "Proof" }),
  makeBlockPlugin({ name: "example", numbered: false, title: "Example" }),
  makeBlockPlugin({ name: "remark", numbered: false, title: "Remark" }),
  makeBlockPlugin({ name: "blockquote", numbered: false, title: "Blockquote" }),
  makeBlockPlugin({ name: "algorithm", title: "Algorithm" }),
];

// ── Master fixture ───────────────────────────────────────────────────────────
// A single document that exercises every FORMAT.md feature.

const MASTER_FIXTURE = `---
title: Test Document
bibliography: refs.bib
numbering: global
math:
  \\R: "\\\\mathbb{R}"
  \\N: "\\\\mathbb{N}"
blocks:
  claim:
    title: Claim
    counter: theorem
---

# Introduction

## Background {-}

### Numbered Sub-subsection

#### Level 4

##### Level 5

###### Level 6

This paragraph has **bold text**, *italic text*, \`inline code\`, ~~strikethrough~~, and ==highlighted== words.

Inline math: $e^{i\\pi} + 1 = 0$. Backslash inline: \\(x^2 + y^2\\).

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

$$
E = mc^2
$$ {#eq:einstein}

\\[
\\sum_{k=0}^n \\binom{n}{k} = 2^n
\\]

::: {#thm:main .theorem title="Main Result"}
Every element of $\\R$ satisfies the property.
:::

::: {.lemma}
A supporting lemma.
:::

::: {.definition}
A formal definition.
:::

::: {.proof}
The proof follows directly. QED.
:::

::: {.blockquote}
A blockquote via fenced div.
:::

::::: {.theorem title="Nested Example"}
Statement.

:::: {.proof}
Nested proof.
::::
:::::

\`\`\`haskell
fibonacci :: Int -> Int
fibonacci 0 = 0
\`\`\`

| Algorithm | Time |
|-----------|------|
| Quicksort | $O(n \\log n)$ |

1. First item
2. Second item

- Bullet one
- Bullet two

- [ ] Unchecked task
- [x] Checked task

See [@thm:main] for the proof.

By [@eq:einstein], energy is mass.

This has a footnote[^1].

[^1]: Footnote content with $x^2$.

![Alt text](image.png)

[Link text](https://example.com)

---
`;

// ── State factory ────────────────────────────────────────────────────────────

function createTestState(doc: string): EditorState {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      documentSemanticsField,
      mathMacrosField,
      createPluginRegistryField(testPlugins),
      blockCounterField,
      editorFocusField,
    ],
  });
}

/** Collect all node names from the syntax tree of a state. */
function getNodeNames(state: EditorState): string[] {
  const names: string[] = [];
  completeSyntaxTree(state).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

/** Find the first node with a given name and return its source text. */
function findNodeText(state: EditorState, name: string): string | undefined {
  let result: string | undefined;
  completeSyntaxTree(state).iterate({
    enter(node) {
      if (result !== undefined) return false;
      if (node.name === name) {
        result = state.doc.sliceString(node.from, node.to);
        return false;
      }
    },
  });
  return result;
}

/** Count occurrences of a node name in the syntax tree. */
function countNodes(state: EditorState, name: string): number {
  let count = 0;
  completeSyntaxTree(state).iterate({
    enter(node) {
      if (node.name === name) count++;
    },
  });
  return count;
}

// ── Tests ────────────────────────────────────────────────────────────────────

const masterState = createTestState(MASTER_FIXTURE);

function completeSyntaxTree(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (tree === null) {
    throw new Error("FORMAT.md coverage fixture did not finish parsing");
  }
  return tree;
}

describe("FORMAT.md coverage: Frontmatter", () => {
  it("parses title from frontmatter", () => {
    const fm = masterState.field(frontmatterField);
    expect(fm.config.title).toBe("Test Document");
  });

  it("parses bibliography path", () => {
    const fm = masterState.field(frontmatterField);
    expect(fm.config.bibliography).toBe("refs.bib");
  });

  it("parses numbering scheme", () => {
    const fm = masterState.field(frontmatterField);
    expect(fm.config.numbering).toBe("global");
  });

  it("parses math macros", () => {
    const fm = masterState.field(frontmatterField);
    expect(fm.config.math).toBeDefined();
    expect(fm.config.math?.["\\R"]).toBe("\\mathbb{R}");
  });

  it("populates mathMacrosField from frontmatter", () => {
    const macros = masterState.field(mathMacrosField);
    expect(macros["\\R"]).toBeDefined();
  });

  it("parses custom block definitions", () => {
    const fm = masterState.field(frontmatterField);
    expect(fm.config.blocks).toBeDefined();
    expect(fm.config.blocks?.["claim"]).toMatchObject({
      title: "Claim",
      counter: "theorem",
    });
  });

  it("reports frontmatter end position > 0", () => {
    const fm = masterState.field(frontmatterField);
    expect(fm.end).toBeGreaterThan(0);
  });

  it("returns empty config when no frontmatter", () => {
    const state = createTestState("# Just content\nNo frontmatter.");
    const fm = state.field(frontmatterField);
    expect(fm.config).toEqual({});
    expect(fm.end).toBe(-1);
  });
});

describe("FORMAT.md coverage: Headings", () => {
  it("parses ATXHeading1", () => {
    expect(getNodeNames(masterState)).toContain("ATXHeading1");
  });

  it("parses ATXHeading2", () => {
    expect(getNodeNames(masterState)).toContain("ATXHeading2");
  });

  it("parses ATXHeading3", () => {
    expect(getNodeNames(masterState)).toContain("ATXHeading3");
  });

  it("parses ATXHeading4", () => {
    expect(getNodeNames(masterState)).toContain("ATXHeading4");
  });

  it("parses ATXHeading5", () => {
    expect(getNodeNames(masterState)).toContain("ATXHeading5");
  });

  it("parses ATXHeading6", () => {
    expect(getNodeNames(masterState)).toContain("ATXHeading6");
  });

  it("extracts heading semantics with correct levels", () => {
    const semantics = masterState.field(documentSemanticsField);
    const levels = semantics.headings.map((h) => h.level);
    expect(levels).toContain(1);
    expect(levels).toContain(2);
    expect(levels).toContain(3);
    expect(levels).toContain(4);
    expect(levels).toContain(5);
    expect(levels).toContain(6);
  });

  it("detects unnumbered heading via {-}", () => {
    const semantics = masterState.field(documentSemanticsField);
    const bg = semantics.headings.find((h) => h.text === "Background");
    expect(bg).toBeDefined();
    expect(bg?.unnumbered).toBe(true);
  });

  it("assigns numbers to numbered headings", () => {
    const semantics = masterState.field(documentSemanticsField);
    const intro = semantics.headings.find((h) => h.text === "Introduction");
    expect(intro).toBeDefined();
    expect(intro?.number).not.toBe("");
  });

  it("handles {.unnumbered} attribute form", () => {
    const doc = "# Heading {.unnumbered}\n\nContent.";
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.headings[0].unnumbered).toBe(true);
  });
});

describe("FORMAT.md coverage: Text Formatting", () => {
  it("parses bold (StrongEmphasis)", () => {
    expect(getNodeNames(masterState)).toContain("StrongEmphasis");
  });

  it("parses italic (Emphasis)", () => {
    expect(getNodeNames(masterState)).toContain("Emphasis");
  });

  it("parses inline code (InlineCode)", () => {
    expect(getNodeNames(masterState)).toContain("InlineCode");
  });

  it("parses strikethrough (Strikethrough)", () => {
    expect(getNodeNames(masterState)).toContain("Strikethrough");
  });

  it("parses highlight (Highlight)", () => {
    expect(getNodeNames(masterState)).toContain("Highlight");
  });
});

describe("FORMAT.md coverage: Math", () => {
  it("parses inline math with $ delimiters (InlineMath)", () => {
    expect(getNodeNames(masterState)).toContain("InlineMath");
    expect(countNodes(masterState, "InlineMath")).toBeGreaterThanOrEqual(1);
  });

  it("parses display math with $$ delimiters (DisplayMath)", () => {
    expect(getNodeNames(masterState)).toContain("DisplayMath");
    expect(countNodes(masterState, "DisplayMath")).toBeGreaterThanOrEqual(1);
  });

  it("parses backslash inline math \\(\\) as InlineMath", () => {
    const doc = "Text \\(x^2 + y^2\\) end.";
    const state = createTestState(doc);
    expect(getNodeNames(state)).toContain("InlineMath");
  });

  it("parses backslash display math \\[\\] as DisplayMath", () => {
    const doc = "\\[\n\\sum_{k=0}^n k\n\\]";
    const state = createTestState(doc);
    expect(getNodeNames(state)).toContain("DisplayMath");
  });

  it("display math can interrupt a paragraph (no blank line needed)", () => {
    const doc = "Text before\n$$\nx^2\n$$";
    const state = createTestState(doc);
    expect(getNodeNames(state)).toContain("DisplayMath");
  });
});

describe("FORMAT.md coverage: Equation Labels", () => {
  it("parses EquationLabel node from $$ {#eq:...}", () => {
    expect(getNodeNames(masterState)).toContain("EquationLabel");
  });

  it("extracts equation semantics with id and number", () => {
    const semantics = masterState.field(documentSemanticsField);
    const eq = semantics.equationById.get("eq:einstein");
    expect(eq).toBeDefined();
    expect(eq?.number).toBe(1);
    expect(eq?.id).toBe("eq:einstein");
  });

  it("collects equation labels via collectEquationLabels", () => {
    const labels = collectEquationLabels(masterState);
    expect(labels.has("eq:einstein")).toBe(true);
    expect(labels.get("eq:einstein")?.number).toBe(1);
  });

  it("assigns sequential numbers to multiple equations", () => {
    const doc = "$$a$$ {#eq:first}\n\n$$b$$ {#eq:second}\n\n$$c$$ {#eq:third}";
    const state = createTestState(doc);
    const labels = collectEquationLabels(state);
    expect(labels.get("eq:first")?.number).toBe(1);
    expect(labels.get("eq:second")?.number).toBe(2);
    expect(labels.get("eq:third")?.number).toBe(3);
  });
});

describe("FORMAT.md coverage: Fenced Divs", () => {
  it("parses FencedDiv nodes", () => {
    expect(getNodeNames(masterState)).toContain("FencedDiv");
  });

  it("parses FencedDivFence (opening and closing)", () => {
    expect(countNodes(masterState, "FencedDivFence")).toBeGreaterThanOrEqual(2);
  });

  it("parses FencedDivAttributes", () => {
    expect(getNodeNames(masterState)).toContain("FencedDivAttributes");
  });

  it("extracts fenced div semantics with primary class", () => {
    const semantics = masterState.field(documentSemanticsField);
    const types = semantics.fencedDivs.map((d) => d.primaryClass);
    expect(types).toContain("theorem");
    expect(types).toContain("lemma");
    expect(types).toContain("definition");
    expect(types).toContain("proof");
    expect(types).toContain("blockquote");
  });

  it("extracts fenced div id attribute", () => {
    const semantics = masterState.field(documentSemanticsField);
    const mainThm = semantics.fencedDivs.find((d) => d.id === "thm:main");
    expect(mainThm).toBeDefined();
    expect(mainThm?.primaryClass).toBe("theorem");
  });

  it("extracts fenced div title", () => {
    const semantics = masterState.field(documentSemanticsField);
    const mainThm = semantics.fencedDivs.find((d) => d.id === "thm:main");
    expect(mainThm).toBeDefined();
    expect(mainThm?.title).toBe("Main Result");
  });

  it("rejects non-canonical self-closing fenced divs", () => {
    const doc = "::: {.theorem} Short statement. :::";
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.fencedDivs).toHaveLength(0);
  });

  it("does not expose self-closing fenced divs in FORMAT coverage", () => {
    const semantics = masterState.field(documentSemanticsField);
    const selfClosing = semantics.fencedDivs.find((d) => d.isSelfClosing);
    expect(selfClosing).toBeUndefined();
  });

  it("handles nested fenced divs (more colons for outer)", () => {
    const semantics = masterState.field(documentSemanticsField);
    // The nested example has an outer theorem and inner proof
    const proofs = semantics.fencedDivs.filter((d) => d.primaryClass === "proof");
    expect(proofs.length).toBeGreaterThanOrEqual(2);
  });

  it("parses class-only fenced-div shorthand", () => {
    const doc = "::: theorem\nContent.\n:::";
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.fencedDivs).toHaveLength(1);
    expect(semantics.fencedDivs[0].primaryClass).toBe("theorem");
    expect(semantics.fencedDivs[0].title).toBeUndefined();
  });

  it("rejects non-canonical trailing titles on fenced-div openers", () => {
    const doc = "::: {.theorem} Main Result\nContent.\n:::";
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.fencedDivs).toHaveLength(0);
  });
});

describe("FORMAT.md coverage: Block Numbering", () => {
  it("assigns numbers to theorem blocks via blockCounterField", () => {
    const counter = masterState.field(blockCounterField);
    const theorems = counter.blocks.filter((b) => b.type === "theorem");
    expect(theorems.length).toBeGreaterThanOrEqual(1);
    expect(theorems[0].number).toBe(1);
  });

  it("shares counter between theorem and lemma (global numbering)", () => {
    const counter = masterState.field(blockCounterField);
    // With global numbering, all numbered blocks share one counter.
    // Verify the exact (type, number) sequence — not just that numbers increase.
    const numbered = counter.blocks.map((b) => ({ type: b.type, number: b.number }));
    expect(numbered.length).toBeGreaterThanOrEqual(2);
    // First two should be theorem=1, lemma=2 (from fixture order)
    expect(numbered[0]).toEqual({ type: "theorem", number: 1 });
    expect(numbered[1]).toEqual({ type: "lemma", number: 2 });
    // Proof should NOT appear (unnumbered)
    expect(numbered.find((b) => b.type === "proof")).toBeUndefined();
  });

  it("does not assign numbers to unnumbered blocks (proof)", () => {
    const counter = masterState.field(blockCounterField);
    const proofs = counter.blocks.filter((b) => b.type === "proof");
    expect(proofs).toHaveLength(0);
  });

  it("populates byId map for blocks with ids", () => {
    const counter = masterState.field(blockCounterField);
    const mainThm = counter.byId.get("thm:main");
    expect(mainThm).toBeDefined();
    expect(mainThm?.type).toBe("theorem");
  });
});

describe("FORMAT.md coverage: Code Blocks", () => {
  it("parses FencedCode node", () => {
    expect(getNodeNames(masterState)).toContain("FencedCode");
  });

  it("includes CodeInfo (language tag)", () => {
    expect(getNodeNames(masterState)).toContain("CodeInfo");
    const langText = findNodeText(masterState, "CodeInfo");
    expect(langText).toBe("haskell");
  });

  it("indented code blocks are disabled (4-space indent is not code)", () => {
    const doc = "    indented text\n\nParagraph after.";
    const state = createTestState(doc);
    // Should NOT produce FencedCode or CodeBlock
    expect(getNodeNames(state)).not.toContain("FencedCode");
    // The text should just be a paragraph
    expect(getNodeNames(state)).toContain("Paragraph");
  });
});

describe("FORMAT.md coverage: Tables", () => {
  it("parses Table node", () => {
    expect(getNodeNames(masterState)).toContain("Table");
  });

  it("parses TableRow nodes", () => {
    expect(countNodes(masterState, "TableRow")).toBeGreaterThanOrEqual(1);
  });

  it("allows math inside table cells", () => {
    const doc = "| Col |\n|-----|\n| $x^2$ |";
    const state = createTestState(doc);
    const names = getNodeNames(state);
    expect(names).toContain("Table");
    expect(names).toContain("InlineMath");
  });
});

describe("FORMAT.md coverage: Lists", () => {
  it("parses OrderedList node", () => {
    expect(getNodeNames(masterState)).toContain("OrderedList");
  });

  it("parses BulletList node", () => {
    expect(getNodeNames(masterState)).toContain("BulletList");
  });

  it("parses ListItem nodes", () => {
    expect(countNodes(masterState, "ListItem")).toBeGreaterThanOrEqual(4);
  });

  it("parses task list items (Task node)", () => {
    expect(getNodeNames(masterState)).toContain("Task");
  });

  it("handles math inside list items", () => {
    const doc = "- Bullet with $O(n)$\n- Another item";
    const state = createTestState(doc);
    const names = getNodeNames(state);
    expect(names).toContain("BulletList");
    expect(names).toContain("InlineMath");
  });
});

describe("FORMAT.md coverage: Blockquotes (fenced div form)", () => {
  it("parses blockquote as a FencedDiv with .blockquote class", () => {
    const semantics = masterState.field(documentSemanticsField);
    const bq = semantics.fencedDivs.find((d) => d.primaryClass === "blockquote");
    expect(bq).toBeDefined();
  });

  it("standard > blockquotes are disabled", () => {
    const doc = "> This is a standard blockquote.\n\nParagraph after.";
    const state = createTestState(doc);
    // removeBlockquote extension disables standard blockquote parsing
    expect(getNodeNames(state)).not.toContain("Blockquote");
  });
});

describe("FORMAT.md coverage: Cross-References", () => {
  it("resolves block reference [@thm:main] to Theorem", () => {
    const result = resolveCrossref(masterState, "thm:main");
    expect(result.kind).toBe("block");
    expect(result.label).toContain("Theorem");
    expect(result.number).toBeDefined();
  });

  it("resolves equation reference [@eq:einstein]", () => {
    const result = resolveCrossref(masterState, "eq:einstein");
    expect(result.kind).toBe("equation");
    expect(result.label).toContain("Eq.");
    expect(result.number).toBe(1);
  });

  it("resolves heading reference [@sec:background] to Section number", () => {
    const state = createTestState([
      "# Intro",
      "",
      "## Background {#sec:background}",
      "",
      "See [@sec:background].",
    ].join("\n"));
    const result = resolveCrossref(state, "sec:background");
    expect(result.kind).toBe("heading");
    expect(result.label).toBe("Section 1.1");
  });

  it("treats unknown reference as citation", () => {
    const result = resolveCrossref(masterState, "karger2000");
    expect(result.kind).toBe("citation");
  });

  it("extracts reference semantics from document analysis", () => {
    const semantics = masterState.field(documentSemanticsField);
    expect(semantics.references.length).toBeGreaterThanOrEqual(1);
    const ref = semantics.references.find((r) => r.ids.includes("thm:main"));
    expect(ref).toBeDefined();
    expect(ref?.bracketed).toBe(true);
  });
});

describe("FORMAT.md coverage: Footnotes", () => {
  it("parses FootnoteRef node", () => {
    expect(getNodeNames(masterState)).toContain("FootnoteRef");
  });

  it("parses FootnoteDef node", () => {
    expect(getNodeNames(masterState)).toContain("FootnoteDef");
  });

  it("extracts footnote semantics (refs and defs)", () => {
    const semantics = masterState.field(documentSemanticsField);
    expect(semantics.footnotes.refs.length).toBeGreaterThanOrEqual(1);
    expect(semantics.footnotes.defs.has("1")).toBe(true);
  });

  it("footnote definition content includes math", () => {
    const semantics = masterState.field(documentSemanticsField);
    const def = semantics.footnotes.defs.get("1");
    expect(def).toBeDefined();
    expect(def?.content).toContain("$x^2$");
  });

  it("supports string footnote ids", () => {
    const doc = "Text[^myid].\n\n[^myid]: Definition here.";
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.footnotes.refs).toHaveLength(1);
    expect(semantics.footnotes.refs[0].id).toBe("myid");
    expect(semantics.footnotes.defs.has("myid")).toBe(true);
  });
});

describe("FORMAT.md coverage: Images", () => {
  it("parses Image node", () => {
    expect(getNodeNames(masterState)).toContain("Image");
  });

  it("image text includes alt and src", () => {
    const text = findNodeText(masterState, "Image");
    expect(text).toBeDefined();
    expect(text).toContain("Alt text");
    expect(text).toContain("image.png");
  });
});

describe("FORMAT.md coverage: Links", () => {
  it("parses Link node", () => {
    expect(getNodeNames(masterState)).toContain("Link");
  });

  it("link text includes url", () => {
    // Find all Link nodes; the cross-references ([@...]) also parse as Links,
    // so we search for the one containing the actual URL.
    const linkTexts: string[] = [];
    completeSyntaxTree(masterState).iterate({
      enter(node) {
        if (node.name === "Link") {
          linkTexts.push(masterState.doc.sliceString(node.from, node.to));
        }
      },
    });
    expect(linkTexts.some((t) => t.includes("https://example.com"))).toBe(true);
  });
});

describe("FORMAT.md coverage: Horizontal Rules", () => {
  it("parses HorizontalRule node", () => {
    // The fixture has a trailing --- after a blank line.
    // The frontmatter also uses --- but those are at the start.
    expect(getNodeNames(masterState)).toContain("HorizontalRule");
  });

  it("distinguishes hr from frontmatter (hr needs blank line before)", () => {
    const doc = "Paragraph.\n\n---\n";
    const state = createTestState(doc);
    const names = getNodeNames(state);
    expect(names).toContain("HorizontalRule");
  });
});

describe("FORMAT.md coverage: Removed Features", () => {
  it("indented code blocks are disabled", () => {
    const doc = "Normal paragraph.\n\n    four-space indented text\n\nAnother paragraph.";
    const state = createTestState(doc);
    // Should parse as paragraphs, not code blocks
    const names = getNodeNames(state);
    expect(names).not.toContain("CodeBlock");
    // The 4-space indent should not produce fenced code
    expect(names.filter((n) => n === "FencedCode")).toHaveLength(0);
  });

  it("standard > blockquotes are disabled", () => {
    const doc = "> Quoted text.\n>\n> More quoted.";
    const state = createTestState(doc);
    expect(getNodeNames(state)).not.toContain("Blockquote");
  });

  it("Pandoc definition lists are not canonical", () => {
    const doc = "Term\n: Definition body\n\nNext paragraph.";
    const state = createTestState(doc);
    const names = getNodeNames(state);
    expect(names).not.toContain("DefinitionList");
    expect(names).not.toContain("DefinitionTerm");
    expect(names).not.toContain("DefinitionDescription");
  });
});

describe("FORMAT.md coverage: Unknown Fenced Div Classes", () => {
  it("unknown fenced div classes are parsed as ordinary fenced divs", () => {
    const doc = "::: {.custom-widget}\nBody\n:::";
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.fencedDivs).toHaveLength(1);
    expect(semantics.fencedDivs[0].primaryClass).toBe("custom-widget");
  });
});

describe("FORMAT.md coverage: Fenced Div Key-Value Attributes", () => {
  it("parses key=value attributes in fenced div header", () => {
    const doc = '::: {.theorem #thm:kv title="Override"}\nContent.\n:::';
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.fencedDivs).toHaveLength(1);
    expect(semantics.fencedDivs[0].id).toBe("thm:kv");
    expect(semantics.fencedDivs[0].primaryClass).toBe("theorem");
  });

  it("handles multiple classes (first is primary type)", () => {
    const doc = "::: {.theorem .important}\nContent.\n:::";
    const state = createTestState(doc);
    const semantics = state.field(documentSemanticsField);
    expect(semantics.fencedDivs[0].primaryClass).toBe("theorem");
    expect(semantics.fencedDivs[0].classes).toContain("important");
  });
});
