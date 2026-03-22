# Lezer-Based Inline Rendering for Fenced-Div Titles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex-based inline rendering with a unified Lezer-based approach, fixing #260 (bold in titles) and all other inline syntax in widget rendering.

**Architecture:** Rewrite `renderInlineMarkdown()` in `src/render/inline-render.ts` to use Lezer tree-walking (like `markdown-to-html.ts` already does for HTML export). The function already has a Lezer parser instance (`inlineParser`); it just needs to walk the full tree instead of only extracting math. Then include the title text in `BlockHeaderWidget` so title inline markdown is rendered by the same path. Delete `addTitleMathDecorations()` entirely.

**Intentional behavior change:** Currently `addTitleMathDecorations` renders `$...$` as KaTeX even in source mode (cursor on fence). After this change, source mode shows fully raw text including math delimiters. This is correct Typora-style behavior — when editing, show source.

**Tech Stack:** Lezer (`@lezer/markdown`), KaTeX, CM6 decorations

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/render/inline-render.ts` | **Rewrite** | Lezer-based `renderInlineMarkdown()` — parse text, walk tree, build DOM nodes for all inline syntax |
| `src/render/inline-render.test.ts` | **Create** | Unit tests for `renderInlineMarkdown()` covering bold, italic, math, strikethrough, highlight, code, nesting |
| `src/plugins/plugin-render.ts` | **Modify** | Include title in `BlockHeaderWidget`, delete `addTitleMathDecorations()` |
| `src/plugins/plugin-render.test.ts` | **Modify** | Add test for title with bold/italic in rendered decorations |

## Callers of `renderInlineMarkdown` (must all benefit, no regressions)

- `src/plugins/plugin-render.ts` — `BlockHeaderWidget.createDOM()`
- `src/render/sidenote-render.ts` — sidenote content rendering
- `src/render/table-render.ts` — table cell content rendering
- `src/app/components/sidenote-margin.tsx` — React sidenote margin component

## Callers of `splitByInlineMath` (may need updating)

- `src/render/hover-preview.ts` — hover preview content (uses segments for custom DOM building)

---

### Task 1: Unit tests for current `renderInlineMarkdown` behavior

**Files:**
- Create: `src/render/inline-render.test.ts`

These tests document current behavior before rewriting. They will also serve as the regression suite for the rewrite.

- [ ] **Step 1: Write tests for current behavior**

```typescript
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { renderInlineMarkdown, splitByInlineMath } from "./inline-render";

// Set up minimal DOM environment for widget rendering
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const { document } = dom.window;
globalThis.document = document as unknown as Document;

describe("renderInlineMarkdown", () => {
  function render(text: string): string {
    const el = document.createElement("span");
    renderInlineMarkdown(el, text);
    return el.innerHTML;
  }

  it("renders plain text", () => {
    expect(render("hello world")).toBe("hello world");
  });

  it("renders bold", () => {
    expect(render("**bold**")).toContain("<strong>");
    expect(render("**bold**")).toContain("bold");
  });

  it("renders italic", () => {
    expect(render("*italic*")).toContain("<em>");
    expect(render("*italic*")).toContain("italic");
  });

  it("renders inline math", () => {
    const html = render("$x^2$");
    expect(html).toContain("katex");
  });

  it("renders mixed: bold + math", () => {
    const html = render("**Main** $x$");
    expect(html).toContain("<strong>");
    expect(html).toContain("katex");
  });
});

describe("splitByInlineMath", () => {
  it("splits text with inline math", () => {
    const segs = splitByInlineMath("foo $x$ bar");
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ isMath: false, content: "foo " });
    expect(segs[1]).toEqual({ isMath: true, content: "x" });
    expect(segs[2]).toEqual({ isMath: false, content: " bar" });
  });

  it("handles text without math", () => {
    const segs = splitByInlineMath("plain text");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ isMath: false, content: "plain text" });
  });
});
```

Note: `jsdom` is already a dev dependency (used by other tests). If `globalThis.document` setup doesn't work cleanly, use Vitest's `environment: 'jsdom'` config or a test setup file. Check existing test patterns in the repo.

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/render/inline-render.test.ts`
Expected: All tests PASS (documenting current behavior).

- [ ] **Step 3: Commit**

```bash
git add src/render/inline-render.test.ts
git commit -m "test: add baseline tests for renderInlineMarkdown before rewrite"
```

---

### Task 2: Add failing tests for unsupported inline syntax

**Files:**
- Modify: `src/render/inline-render.test.ts`

These tests document the NEW behavior we want after the rewrite.

- [ ] **Step 1: Add tests for currently-broken inline syntax**

```typescript
// Add to the existing describe("renderInlineMarkdown") block:

it("renders strikethrough", () => {
  const html = render("~~deleted~~");
  expect(html).toContain("<del>");
  expect(html).toContain("deleted");
});

it("renders highlight", () => {
  const html = render("==highlighted==");
  expect(html).toContain("<mark>");
  expect(html).toContain("highlighted");
});

it("renders inline code", () => {
  const html = render("`code`");
  expect(html).toContain("<code>");
  expect(html).toContain("code");
});

it("renders nested bold inside italic", () => {
  const html = render("*text with **bold** inside*");
  expect(html).toContain("<em>");
  expect(html).toContain("<strong>");
});

it("renders a block header with title: Theorem 1 (**3SUM**)", () => {
  // This is the exact #260 scenario
  const html = render("Theorem 1 (**3SUM**)");
  expect(html).toContain("<strong>");
  expect(html).toContain("3SUM");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/render/inline-render.test.ts`
Expected: New tests FAIL (strikethrough, highlight, inline code, nesting — these are not yet supported).

- [ ] **Step 3: Commit failing tests**

```bash
git add src/render/inline-render.test.ts
git commit -m "test: add failing tests for strikethrough, highlight, code in renderInlineMarkdown (#260)"
```

---

### Task 3: Rewrite `renderInlineMarkdown` to use Lezer tree-walking

**Files:**
- Modify: `src/render/inline-render.ts`

Replace the `splitByInlineMath` + regex approach with a full Lezer tree walk, modeled on `renderChildren`/`renderInlineNode` in `markdown-to-html.ts` but producing DOM nodes instead of HTML strings.

- [ ] **Step 1: Rewrite the implementation**

The new `renderInlineMarkdown` should:

1. Parse `text` with `inlineParser` (already exists as module-level const)
2. Get the `Document > Paragraph` node (same pattern as `renderInline` in `markdown-to-html.ts`)
3. Walk children recursively, creating DOM elements:
   - `StrongEmphasis` → `<strong>`, recurse into children
   - `Emphasis` → `<em>`, recurse into children
   - `Strikethrough` → `<del>`, recurse into children
   - `Highlight` → `<mark>`, recurse into children
   - `InlineCode` → `<code>` with text between `CodeMark` delimiters
   - `InlineMath` → KaTeX-rendered `<span>` (existing logic)
   - `Escape` → text node with backslash stripped
   - `HardBreak` → `<br>`
   - Mark nodes (`EmphasisMark`, `CodeMark`, `InlineMathMark`, `StrikethroughMark`, `HighlightMark`) → skip
   - Text gaps between children → `document.createTextNode()`
   - Unknown nodes → `document.createTextNode()` with raw text

Key reference: `src/app/markdown-to-html.ts` lines 598–742. The logic is identical — just producing DOM nodes instead of HTML strings.

Keep `splitByInlineMath` exported (used by `hover-preview.ts`). It can stay unchanged since it's a useful utility. But `renderInlineMarkdown` no longer calls it.

Delete `renderTextSegment` (the regex-based bold/italic function) — it's fully replaced.

```typescript
import katex from "katex";
import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { markdownExtensions } from "../parser";
import { stripMathDelimiters } from "./math-render";

const inlineParser = baseParser.configure(markdownExtensions);

// Re-export for hover-preview.ts
export { type InlineSegment };
interface InlineSegment {
  isMath: boolean;
  content: string;
}

export function splitByInlineMath(text: string): InlineSegment[] {
  // ... unchanged ...
}

/** Set of delimiter node names to skip when walking inline content. */
const MARK_NODES = new Set([
  "EmphasisMark",
  "CodeMark",
  "InlineMathMark",
  "StrikethroughMark",
  "HighlightMark",
]);

/**
 * Render inline markdown into a DOM container using Lezer tree-walking.
 *
 * Handles: bold, italic, strikethrough, highlight, inline code, inline math,
 * escapes, hard breaks. Used by block header widgets, sidenote margin,
 * table cells, and footnote sections.
 */
export function renderInlineMarkdown(
  container: HTMLElement,
  text: string,
  macros: Record<string, string> = {},
): void {
  const tree = inlineParser.parse(text);
  const doc = tree.topNode;
  const para = doc.firstChild;
  if (!para) {
    container.appendChild(document.createTextNode(text));
    return;
  }
  renderChildren(container, para, text, macros);
}

/** Recursively render inline children of a Lezer node into a DOM container. */
function renderChildren(
  container: HTMLElement,
  node: SyntaxNode,
  text: string,
  macros: Record<string, string>,
): void {
  let pos = node.from;
  let child = node.firstChild;

  while (child) {
    // Text gap before this child
    if (child.from > pos) {
      container.appendChild(document.createTextNode(text.slice(pos, child.from)));
    }
    renderInlineNode(container, child, text, macros);
    pos = child.to;
    child = child.nextSibling;
  }

  // Trailing text after last child
  if (pos < node.to) {
    container.appendChild(document.createTextNode(text.slice(pos, node.to)));
  }
}

/** Render a single inline Lezer node into a DOM container. */
function renderInlineNode(
  container: HTMLElement,
  node: SyntaxNode,
  text: string,
  macros: Record<string, string>,
): void {
  // Skip delimiter marks
  if (MARK_NODES.has(node.name)) return;

  switch (node.name) {
    case "Emphasis": {
      const em = document.createElement("em");
      renderChildren(em, node, text, macros);
      container.appendChild(em);
      break;
    }
    case "StrongEmphasis": {
      const strong = document.createElement("strong");
      renderChildren(strong, node, text, macros);
      container.appendChild(strong);
      break;
    }
    case "Strikethrough": {
      const del = document.createElement("del");
      renderChildren(del, node, text, macros);
      container.appendChild(del);
      break;
    }
    case "Highlight": {
      const mark = document.createElement("mark");
      renderChildren(mark, node, text, macros);
      container.appendChild(mark);
      break;
    }
    case "InlineCode": {
      const code = document.createElement("code");
      const marks = node.getChildren("CodeMark");
      if (marks.length >= 2) {
        code.textContent = text.slice(marks[0].to, marks[marks.length - 1].from);
      } else {
        code.textContent = text.slice(node.from, node.to);
      }
      container.appendChild(code);
      break;
    }
    case "InlineMath": {
      const span = document.createElement("span");
      const raw = text.slice(node.from, node.to);
      const latex = stripMathDelimiters(raw, false);
      try {
        span.innerHTML = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false,
          macros,
        });
      } catch {
        span.textContent = raw;
      }
      container.appendChild(span);
      break;
    }
    case "Escape": {
      // \* → *, \$ → $, etc.
      container.appendChild(
        document.createTextNode(text.slice(node.from + 1, node.to)),
      );
      break;
    }
    case "HardBreak": {
      container.appendChild(document.createElement("br"));
      break;
    }
    default: {
      // Unknown node or plain text — render as text
      container.appendChild(
        document.createTextNode(text.slice(node.from, node.to)),
      );
      break;
    }
  }
}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run src/render/inline-render.test.ts`
Expected: ALL tests pass (both baseline and new).

- [ ] **Step 3: Run full test suite for regressions**

Run: `npx vitest run`
Expected: No regressions in sidenote, table, or plugin-render tests.

- [ ] **Step 4: Commit**

```bash
git add src/render/inline-render.ts src/render/inline-render.test.ts
git commit -m "refactor: rewrite renderInlineMarkdown to use Lezer tree-walking (#260)

Replaces regex-based bold/italic parsing and the split-by-math approach
with a full Lezer tree walk. Now handles strikethrough, highlight, inline
code, escapes, hard breaks, and nested formatting."
```

---

### Task 4: Include title in `BlockHeaderWidget`, delete `addTitleMathDecorations`

**Files:**
- Modify: `src/plugins/plugin-render.ts`

Now that `renderInlineMarkdown` handles all inline syntax via Lezer, we include the title in the widget label and delete the regex-based math decorator.

- [ ] **Step 1: Write failing test for title rendering**

In `src/plugins/plugin-render.test.ts`, add a test that verifies a fenced div with `**bold**` in the title produces a decoration whose widget includes `<strong>`. (Follow existing `plugin-render.test.ts` patterns — they use `EditorState.create` + `state.field(_blockDecorationFieldForTest)`.)

The test document should be:
```markdown
::: {.theorem} **Main Result**
Content.
:::
```

The test should verify two things:
1. The replace decoration range extends from `openFenceFrom` to `titleTo` (covering the entire opening line including title).
2. The rendered widget DOM contains `<strong>` for the bold title text.

Also add a test with no title to verify the replace range is `(openFenceFrom, openFenceTo)` when title is absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/plugin-render.test.ts`
Expected: FAIL — title is currently not part of the widget.

- [ ] **Step 3: Modify `addHeaderWidgetDecoration` to include title**

In `src/plugins/plugin-render.ts`:

1. Change `addHeaderWidgetDecoration` to extend the replace range through the title:
   ```typescript
   function addHeaderWidgetDecoration(
     div: FencedDivInfo,
     header: string,
     macros: Record<string, string>,
     macrosKey: string,
     items: Range<Decoration>[],
   ): void {
     // Replace range covers fence + attrs + title
     const replaceEnd = div.titleTo ?? div.titleFrom ?? div.openFenceTo;
     // Build full label: "Theorem 1 (User Title)" — title already in header from formatBlockHeader
     const widget = new BlockHeaderWidget(header, macros, macrosKey);
     widget.sourceFrom = div.openFenceFrom;
     items.push(
       Decoration.replace({ widget }).range(div.openFenceFrom, replaceEnd),
     );
   }
   ```

   Currently `labelAttrs` does NOT include the title — `formatBlockHeader()` in `block-render.ts` supports it (`parts.push(\` (\${attrs.title})\`)`) but the title was never passed. Two changes needed:
   - Add `title: div.title` to `labelAttrs` so `formatBlockHeader` produces e.g. "Theorem 1 (**3SUM**)"
   - Extend the replace range to `div.titleTo` so the raw title text is covered by the widget

   Update `labelAttrs` construction (~line 477):
   ```typescript
   const labelAttrs: BlockAttrs = {
     type: div.className,
     id: div.id,
     title: div.title,  // ← add this (was missing — title was never passed to formatBlockHeader)
     number: numberEntry?.number,
   };
   ```

2. Delete `addTitleMathDecorations` function entirely (lines 388–409).

3. Remove all calls to `addTitleMathDecorations` (lines 493 and 502).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/plugins/plugin-render.test.ts`
Expected: All tests pass including the new title test.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/plugin-render.ts src/plugins/plugin-render.test.ts
git commit -m "fix: render inline markdown in fenced-div titles (#260)

Include title text in BlockHeaderWidget's replace range so
renderInlineMarkdown handles bold, italic, math, etc. in titles.
Delete addTitleMathDecorations — the regex approach is fully replaced
by Lezer-based rendering in the widget."
```

---

### Task 5: Browser verification

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Launch Playwright browser**

Run: `npm run chrome`

- [ ] **Step 3: Open the file with bold in title**

```javascript
await page.evaluate(() => __app.openFile("posts/2014-04-05-a-common-3sum-hard-reduction.md"));
```

- [ ] **Step 4: Verify bold renders in the problem title**

Look for the `::: {.problem} **3SUM**` block. The title "3SUM" should appear bold in the rendered header, not as literal `**3SUM**`.

Use `page.evaluate(() => __cmDebug.dump())` to check decoration state.

Take a screenshot to verify visually.

- [ ] **Step 5: Verify no regressions in other blocks**

Navigate to a file with math in titles (e.g., theorem blocks with `$x$` in the title). Verify math still renders in titles.

Check that clicking on a block header reveals source correctly (Typora-style toggle).

---

## Summary of changes

1. **`inline-render.ts`**: Rewrite `renderInlineMarkdown()` — Lezer tree-walk replacing regex. Supports all inline syntax. `splitByInlineMath` stays for `hover-preview.ts`.
2. **`plugin-render.ts`**: Title included in `BlockHeaderWidget` label. `addTitleMathDecorations` deleted. Replace range extends through title.
3. **`inline-render.test.ts`**: New test file covering all inline syntax.
4. **`plugin-render.test.ts`**: New test for title with bold.

Net effect: Every caller of `renderInlineMarkdown` (block headers, sidenotes, tables, margin) now gets full inline markdown support for free.
