/**
 * Randomized stress tests for rich-mode editing flows.
 *
 * Uses fast-check to generate random sequences of editing operations
 * (insertions, deletions, cursor moves, mode switches) and verifies
 * invariants hold after every step: no crashes, valid cursor, consistent
 * parser state, valid mode, coherent semantics.
 *
 * Every dispatch and mode-switch must succeed without throwing. Any
 * exception is a real test failure, not a tolerated side-effect.
 *
 * @see https://github.com/chaoxu/coflat/issues/439
 */
import { describe, it, afterEach } from "vitest";
import fc from "fast-check";
import { syntaxTree } from "@codemirror/language";
import { type DecorationSet, EditorView } from "@codemirror/view";
import { createEditor, editorModeField, setEditorMode, type EditorMode } from "./editor";
import { documentSemanticsField } from "../state/document-analysis";

// ── Seed documents ───────────────────────────────────────────────────────────

const SEED_DOCUMENTS = [
  // Mixed features
  `---
title: Stress Test
---

# Heading One

Some text with **bold** and *italic* and \`code\`.

::: {.theorem #thm:main title="Main Theorem"}
Let $x \\in \\mathbb{R}$. Then $x^2 \\geq 0$.
:::

::: {.proof}
Obvious from the definition.
:::

$$
  E = mc^2
$$ {#eq:energy}

See [@thm:main] and [@eq:energy].

- Item one
- Item two
  - Nested item

| A | B |
|---|---|
| 1 | 2 |

\`\`\`javascript
const x = 1;
\`\`\`

[^fn1]: A footnote.
`,

  // Math-heavy
  `# Equations

Inline math: $\\alpha + \\beta = \\gamma$.

$$
  \\int_0^\\infty e^{-x} dx = 1
$$

$$
  \\sum_{i=1}^n i = \\frac{n(n+1)}{2}
$$ {#eq:sum}

::: {.lemma}
For all $n$, equation [@eq:sum] holds.
:::
`,

  // Minimal
  `# Title

A paragraph.
`,

  // Nested fenced divs
  `# Nested

::: {.theorem #thm:nested title="Nested Theorem"}
Statement here.

::: {.proof}
Proof of the nested theorem.
:::
:::

Some text after.
`,

  // Table-heavy
  `# Tables

| Name  | Value | Description |
|-------|-------|-------------|
| Alpha | 1     | First       |
| Beta  | 2     | Second      |

Paragraph between tables.

| X | Y |
|---|---|
| a | b |
`,
];

// ── Operation types ──────────────────────────────────────────────────────────

interface InsertText { type: "insert"; text: string }
interface DeleteRange { type: "delete"; count: number }
interface MoveCursor { type: "move"; pos: number }
interface NewLine { type: "newline" }
interface ModeSwitch { type: "mode"; mode: EditorMode }
interface InsertSnippet { type: "snippet"; snippet: string }

type EditOp = InsertText | DeleteRange | MoveCursor | NewLine | ModeSwitch | InsertSnippet;

// Snippets that exercise feature boundaries
const SNIPPETS = [
  "::: {.theorem}\nContent.\n:::\n",
  "::: {.definition}\nDef body.\n:::\n",
  "::: {.proof}\nProof body.\n:::\n",
  "$x^2$",
  "$$\n  y = mx + b\n$$\n",
  "$$\n  f(x)\n$$ {#eq:test}\n",
  "**bold text**",
  "*italic text*",
  "`inline code`",
  "[@ref:id]",
  "[^footnote]: Note text.\n",
  "- list item\n",
  "- item 1\n  - nested\n",
  "| A | B |\n|---|---|\n| 1 | 2 |\n",
  "```python\nprint('hi')\n```\n",
  "# New Heading\n",
  "## Subheading\n",
  "---\n",
];

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbInsert: fc.Arbitrary<InsertText> = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((text) => ({ type: "insert" as const, text }));

const arbDelete: fc.Arbitrary<DeleteRange> = fc
  .integer({ min: 1, max: 10 })
  .map((count) => ({ type: "delete" as const, count }));

/** Position is normalized to doc bounds at apply time. */
const arbMove: fc.Arbitrary<MoveCursor> = fc
  .nat({ max: 5000 })
  .map((pos) => ({ type: "move" as const, pos }));

const arbNewline: fc.Arbitrary<NewLine> = fc.constant({ type: "newline" as const });

const arbMode: fc.Arbitrary<ModeSwitch> = fc
  .constantFrom("rich" as const, "source" as const)
  .map((mode) => ({ type: "mode" as const, mode }));

const arbSnippet: fc.Arbitrary<InsertSnippet> = fc
  .constantFrom(...SNIPPETS)
  .map((snippet) => ({ type: "snippet" as const, snippet }));

const arbOp: fc.Arbitrary<EditOp> = fc.oneof(
  { weight: 4, arbitrary: arbInsert },
  { weight: 3, arbitrary: arbDelete },
  { weight: 3, arbitrary: arbMove },
  { weight: 2, arbitrary: arbNewline },
  { weight: 2, arbitrary: arbMode },
  { weight: 3, arbitrary: arbSnippet },
);

const arbOps: fc.Arbitrary<EditOp[]> = fc.array(arbOp, { minLength: 10, maxLength: 60 });

/** Shorter sequences for tests that do extra work per step (e.g. mode switching). */
const arbShortOps: fc.Arbitrary<EditOp[]> = fc.array(arbOp, { minLength: 5, maxLength: 20 });

const arbSeedIndex: fc.Arbitrary<number> = fc.nat({ max: SEED_DOCUMENTS.length - 1 });

const tableModeSwitchRegressionOps: readonly EditOp[] = [
  { type: "move", pos: 66 },
  { type: "move", pos: 4456 },
  { type: "move", pos: 3878 },
  { type: "move", pos: 3017 },
  { type: "delete", count: 5 },
  { type: "move", pos: 1328 },
  { type: "insert", text: "N0" },
  { type: "snippet", snippet: "$$\n  y = mx + b\n$$\n" },
  { type: "move", pos: 1431 },
  { type: "newline" },
  { type: "move", pos: 1531 },
  { type: "delete", count: 3 },
  { type: "delete", count: 7 },
  { type: "mode", mode: "rich" },
  { type: "delete", count: 10 },
  { type: "snippet", snippet: "| A | B |\n|---|---|\n| 1 | 2 |\n" },
  { type: "mode", mode: "source" },
  { type: "delete", count: 3 },
  { type: "newline" },
  { type: "move", pos: 2006 },
  { type: "mode", mode: "rich" },
];

const mathDecorationDeleteRegressionOps: readonly EditOp[] = [
  { type: "move", pos: 2085 },
  { type: "move", pos: 408 },
  { type: "insert", text: "%+:p P;" },
  { type: "mode", mode: "rich" },
  { type: "snippet", snippet: "| A | B |\n|---|---|\n| 1 | 2 |\n" },
  { type: "insert", text: "6n2" },
  { type: "delete", count: 7 },
  { type: "snippet", snippet: "$$\n  y = mx + b\n$$\n" },
  { type: "delete", count: 8 },
  { type: "newline" },
  { type: "delete", count: 3 },
  { type: "insert", text: "&6\"A" },
  { type: "newline" },
  { type: "move", pos: 1698 },
  { type: "newline" },
  { type: "delete", count: 4 },
  { type: "move", pos: 11 },
  { type: "insert", text: "2bNKX2_9>%" },
  { type: "insert", text: "-c`O%D\\\\vHb" },
  { type: "snippet", snippet: "[^footnote]: Note text.\n" },
  { type: "newline" },
];

// ── Apply + invariant checking ───────────────────────────────────────────────

/** Apply an operation. Throws on dispatch failure — no exceptions are swallowed. */
function applyOp(view: EditorView, op: EditOp): void {
  const docLen = view.state.doc.length;
  const head = view.state.selection.main.head;

  switch (op.type) {
    case "insert":
      view.dispatch({ changes: { from: head, insert: op.text } });
      break;
    case "delete": {
      const from = Math.max(0, head - op.count);
      if (from < head) {
        view.dispatch({ changes: { from, to: head } });
      }
      break;
    }
    case "move": {
      const pos = Math.min(op.pos, docLen);
      view.dispatch({ selection: { anchor: pos } });
      break;
    }
    case "newline":
      view.dispatch({ changes: { from: head, insert: "\n" } });
      break;
    case "mode":
      setEditorMode(view, op.mode);
      break;
    case "snippet":
      view.dispatch({ changes: { from: head, insert: op.snippet } });
      break;
  }
}

function assertDecorationSetInBounds(
  decorations: DecorationSet,
  docLen: number,
  stepIndex: number,
  op: EditOp,
  providerIndex: number,
): void {
  const cursor = decorations.iter();
  while (cursor.value) {
    if (cursor.from < 0 || cursor.to > docLen) {
      throw new Error(
        `Step ${stepIndex} (${op.type}): decoration provider ${providerIndex} range `
        + `[${cursor.from}, ${cursor.to}] outside [0, ${docLen}]`,
      );
    }
    cursor.next();
  }
}

function checkInvariants(view: EditorView, stepIndex: number, op: EditOp): void {
  const state = view.state;
  const docLen = state.doc.length;
  const sel = state.selection.main;

  // Cursor within document bounds
  if (sel.head < 0 || sel.head > docLen) {
    throw new Error(
      `Step ${stepIndex} (${op.type}): cursor head ${sel.head} outside [0, ${docLen}]`,
    );
  }
  if (sel.anchor < 0 || sel.anchor > docLen) {
    throw new Error(
      `Step ${stepIndex} (${op.type}): cursor anchor ${sel.anchor} outside [0, ${docLen}]`,
    );
  }

  // Mode field is valid
  const mode = state.field(editorModeField);
  if (mode !== "rich" && mode !== "source") {
    throw new Error(`Step ${stepIndex} (${op.type}): invalid mode "${mode}"`);
  }

  // Syntax tree is accessible and walkable
  const tree = syntaxTree(state);
  let nodeCount = 0;
  tree.iterate({
    enter() {
      nodeCount++;
      if (nodeCount > 500) return false;
    },
  });

  // Semantics field is accessible and internally consistent
  const semantics = state.field(documentSemanticsField);
  for (const heading of semantics.headings) {
    if (heading.from < 0 || heading.from > docLen) {
      throw new Error(
        `Step ${stepIndex} (${op.type}): heading.from ${heading.from} outside [0, ${docLen}]`,
      );
    }
  }
  for (const eq of semantics.equations) {
    if (eq.from < 0 || eq.from > docLen) {
      throw new Error(
        `Step ${stepIndex} (${op.type}): equation.from ${eq.from} outside [0, ${docLen}]`,
      );
    }
  }

  // Document text is retrievable
  state.doc.toString();

  const decorationProviders = state.facet(EditorView.decorations);
  for (let providerIndex = 0; providerIndex < decorationProviders.length; providerIndex++) {
    const provider = decorationProviders[providerIndex];
    const decorations = typeof provider === "function" ? provider(view) : provider;
    assertDecorationSetInBounds(decorations, docLen, stepIndex, op, providerIndex);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMountedEditor(doc: string): { view: EditorView; parent: HTMLElement } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = createEditor({ parent, doc });
  return { view, parent };
}

function cleanupEditor(view: EditorView, parent: HTMLElement): void {
  view.destroy();
  parent.remove();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("rich-mode stress", { timeout: 60_000 }, () => {
  let activeView: EditorView | undefined;
  let activeParent: HTMLElement | undefined;

  afterEach(() => {
    if (activeView && activeParent) {
      cleanupEditor(activeView, activeParent);
    }
    activeView = undefined;
    activeParent = undefined;
  });

  it("handles table insertion after repeated rich-mode reconfiguration", () => {
    const { view, parent } = createMountedEditor(SEED_DOCUMENTS[4]);
    activeView = view;
    activeParent = parent;

    for (let i = 0; i < tableModeSwitchRegressionOps.length; i++) {
      const op = tableModeSwitchRegressionOps[i];
      applyOp(view, op);
      checkInvariants(view, i, op);
    }

    cleanupEditor(view, parent);
    activeView = undefined;
    activeParent = undefined;
  });

  it("keeps math decorations in bounds after deleting around stale math ranges", () => {
    const { view, parent } = createMountedEditor(SEED_DOCUMENTS[2]);
    activeView = view;
    activeParent = parent;

    for (let i = 0; i < mathDecorationDeleteRegressionOps.length; i++) {
      const op = mathDecorationDeleteRegressionOps[i];
      applyOp(view, op);
      checkInvariants(view, i, op);
    }

    cleanupEditor(view, parent);
    activeView = undefined;
    activeParent = undefined;
  });

  it("random edit sequences preserve editor invariants", () => {
    fc.assert(
      fc.property(arbSeedIndex, arbOps, (seedIndex, ops) => {
        const { view, parent } = createMountedEditor(SEED_DOCUMENTS[seedIndex]);
        activeView = view;
        activeParent = parent;

        for (let i = 0; i < ops.length; i++) {
          applyOp(view, ops[i]);
          checkInvariants(view, i, ops[i]);
        }

        cleanupEditor(view, parent);
        activeView = undefined;
        activeParent = undefined;
      }),
      { numRuns: 50, endOnFailure: true },
    );
  });

  it("rapid mode switching under edits does not crash", () => {
    fc.assert(
      fc.property(arbSeedIndex, arbShortOps, (seedIndex, ops) => {
        const { view, parent } = createMountedEditor(SEED_DOCUMENTS[seedIndex]);
        activeView = view;
        activeParent = parent;

        const modes: EditorMode[] = ["rich", "source"];
        for (let i = 0; i < ops.length; i++) {
          setEditorMode(view, modes[i % 2]);
          applyOp(view, ops[i]);
          checkInvariants(view, i, ops[i]);
        }

        // End in rich mode and verify mode actually changed
        setEditorMode(view, "rich");
        const finalMode = view.state.field(editorModeField);
        if (finalMode !== "rich") {
          throw new Error(`Expected final mode "rich", got "${finalMode}"`);
        }

        cleanupEditor(view, parent);
        activeView = undefined;
        activeParent = undefined;
      }),
      { numRuns: 30, endOnFailure: true },
    );
  });

  it("snippet insertion at boundary positions does not crash", () => {
    fc.assert(
      fc.property(
        arbSeedIndex,
        fc.array(fc.constantFrom(...SNIPPETS), { minLength: 5, maxLength: 20 }),
        fc.array(fc.boolean(), { minLength: 5, maxLength: 20 }),
        (seedIndex, snippets, atEnd) => {
          const { view, parent } = createMountedEditor(SEED_DOCUMENTS[seedIndex]);
          activeView = view;
          activeParent = parent;

          for (let i = 0; i < snippets.length; i++) {
            const docLen = view.state.doc.length;
            const pos = atEnd[i % atEnd.length] ? docLen : 0;
            applyOp(view, { type: "move", pos });
            applyOp(view, { type: "snippet", snippet: snippets[i] });
            checkInvariants(view, i, { type: "snippet", snippet: snippets[i] });
          }

          cleanupEditor(view, parent);
          activeView = undefined;
          activeParent = undefined;
        },
      ),
      { numRuns: 30, endOnFailure: true },
    );
  });

  it("delete-heavy sequences on structured content do not crash", () => {
    fc.assert(
      fc.property(
        arbSeedIndex,
        fc.infiniteStream(fc.tuple(fc.double({ min: 0, max: 1 }), fc.double({ min: 0, max: 1 }))),
        (seedIndex, rng) => {
          const { view, parent } = createMountedEditor(SEED_DOCUMENTS[seedIndex]);
          activeView = view;
          activeParent = parent;

          let iterations = 0;
          for (const [posFrac, lenFrac] of rng) {
            if (view.state.doc.length === 0 || iterations >= 500) break;
            const docLen = view.state.doc.length;
            const pos = Math.min(Math.floor(posFrac * docLen), docLen - 1);
            const deleteLen = Math.min(1 + Math.floor(lenFrac * 5), docLen - pos);
            if (deleteLen > 0) {
              view.dispatch({
                changes: { from: pos, to: pos + deleteLen },
                selection: { anchor: Math.min(pos, docLen - deleteLen) },
              });
              checkInvariants(view, iterations, { type: "delete", count: deleteLen });
            }
            iterations++;
          }

          cleanupEditor(view, parent);
          activeView = undefined;
          activeParent = undefined;
        },
      ),
      { numRuns: 20, endOnFailure: true },
    );
  });
});
