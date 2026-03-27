# Monospace Source Syntax When Editing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Rich mode reveals source syntax during editing, non-prose elements render in monospace. Prose content keeps its natural font.

**Architecture:** Most syntax markers (`**`, `*`, `~~`, `[`, `]`, `(`, `)`, `#`) already get monospace via Lezer's `.tok-meta` class and the existing CSS rule in `typography-theme.ts`. Only three gaps remain: (1) math LaTeX content between `$` delimiters, (2) link URLs (`.tok-url` class exists but lacks monospace CSS), and (3) fenced div fence lines in source mode (CM6 doesn't tokenize custom parser nodes, so the entire line is a raw text node).

**Intentional behavior change:** Fenced div fence lines in source mode currently render entirely in serif. After this change, the syntax portion (`::: {.class #id}`) will be monospace while the title text stays in its natural font.

**Tech Stack:** CM6 decorations (`Decoration.mark`), CSS in theme files, Lezer syntax tree

---

## Current State (verified in browser)

`.tok-meta` CSS rule (typography-theme.ts:107) already applies `fontFamily: monoFont` to:
- Bold/italic markers (`**`, `*`) — `tok-strong tok-meta` / `tok-emphasis tok-meta`
- Strikethrough markers (`~~`) — `tok-meta`
- Link brackets (`[`, `]`, `(`, `)`) — `tok-link tok-meta`
- Heading `#` markers — `tok-heading tok-meta`
- Math `$` delimiters — `tok-meta`

## Gaps to Fix

### Gap 1: Link URLs — CSS-only fix
- `.tok-url` exists on URL spans but has no `fontFamily: monoFont`
- Fix: Add `.tok-url` to the existing `.tok-meta` CSS rule

### Gap 2: Math LaTeX content — mark decoration needed
- Between `$` delimiters, the LaTeX source (e.g., `e^{i\pi}`) is a raw text node with no `<span>`
- The `$` delimiters already get `.tok-meta` (monospace), but content between them is unstyled
- Fix: Add `Decoration.mark({ class: "cg-math-source" })` in math-render.ts when cursor is inside math
- The mark should cover the InlineMath/DisplayMath node content (between InlineMathMark delimiters)

### Gap 3: Fenced div fence syntax — mark decoration needed
- In source mode (`cg-block-source`), the entire fence line is a single text node: `::: {.theorem} Title`
- CM6 doesn't apply syntax highlighting to custom parser nodes (FencedDivFence, FencedDivAttributes)
- Fix: Add `Decoration.mark({ class: "cg-source-syntax" })` on the `FencedDivFence` and `FencedDivAttributes` ranges when in source mode
- The `FencedDivTitle` portion stays in its natural font (prose)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/editor/typography-theme.ts` | **Modify** | Add `.tok-url` to monospace rule; add `.cg-math-source` and `.cg-source-syntax` CSS |
| `src/render/math-render.ts` | **Modify** | Add `cg-math-source` mark decoration on math content when cursor is inside |
| `src/plugins/plugin-render.ts` | **Modify** | Add `cg-source-syntax` mark decorations on FencedDivFence + FencedDivAttributes in source mode |

---

### Task 1: Link URLs monospace (CSS-only)

**Files:**
- Modify: `src/editor/typography-theme.ts:107`

- [ ] **Step 1: Add `.tok-url` to the existing monospace CSS rule**

In `src/editor/typography-theme.ts`, change line 107:

```typescript
// Before:
".tok-meta, .tok-processingInstruction": {
    fontFamily: monoFont,
    color: "var(--cg-fg)",
},

// After:
".tok-meta, .tok-processingInstruction, .tok-url": {
    fontFamily: monoFont,
    color: "var(--cg-fg)",
},
```

- [ ] **Step 2: Verify in browser**

Start dev server + Chrome. Insert `[link](https://example.com)`, put cursor inside the link. The URL `https://example.com` should render in monospace. The link text `link` should stay serif.

- [ ] **Step 3: Commit**

```bash
git add src/editor/typography-theme.ts
git commit -m "style: make link URLs monospace when editing (#267)"
```

---

### Task 2: Math LaTeX content monospace

**Files:**
- Modify: `src/render/math-render.ts`
- Modify: `src/editor/typography-theme.ts`

When the cursor is inside a math expression and the `MathWidget` is removed (revealing source), the LaTeX content between `$` delimiters needs a monospace mark decoration. The `$` delimiters already get monospace via `.tok-meta`.

- [ ] **Step 1: Add CSS for `cg-math-source`**

In `src/editor/typography-theme.ts`, add after the `.tok-meta` rule:

```typescript
/* Math source content — LaTeX between $ delimiters when editing */
".cg-math-source": {
    fontFamily: monoFont,
},
```

- [ ] **Step 2: Read math-render.ts to understand the skip logic**

Read `src/render/math-render.ts` to understand how `buildMathItems` works. When `shouldSkip(node.from, node.to)` returns true (cursor is inside), no `Decoration.replace` is added — the raw source is shown. We need to add a `Decoration.mark` instead.

The function `buildMathItems` in math-render.ts currently:
1. Iterates InlineMath/DisplayMath nodes
2. If `shouldSkip` (cursor inside): `return false` — skips entirely
3. If not skipped: adds `Decoration.replace` with MathWidget

We need to change the skip case to:
1. If `shouldSkip` (cursor inside): add `Decoration.mark({ class: "cg-math-source" })` covering the content between delimiters (from first InlineMathMark.to to last InlineMathMark.from), then `return false`

The mark should NOT cover the `$` delimiters themselves (they already get `.tok-meta` monospace from Lezer highlighting).

- [ ] **Step 3: Implement the mark decoration**

In `src/render/math-render.ts`, modify `buildMathItems`. When `shouldSkip` returns true, instead of just `return false`, extract the content range from InlineMathMark children and add a mark decoration:

```typescript
if (shouldSkip(node.from, node.to)) {
    // Add monospace mark on content between delimiters
    const isDisplay = node.type.name === "DisplayMath";
    const markName = isDisplay ? "DisplayMathMark" : "InlineMathMark";
    const marks = node.node.getChildren(markName);
    if (marks.length >= 2) {
        const contentFrom = marks[0].to;
        const contentTo = marks[marks.length - 1].from;
        if (contentFrom < contentTo) {
            items.push(
                Decoration.mark({ class: "cg-math-source" }).range(contentFrom, contentTo),
            );
        }
    }
    return false;
}
```

Note: For `DisplayMath`, the delimiter mark node name may differ. Check with `node.node.getChildren("DisplayMathMark")` or look at the Lezer tree structure for `$$...$$`. It might use `InlineMathMark` for both (the custom parser may reuse the same name). Read the parser code or test in the browser to confirm.

- [ ] **Step 4: Verify in browser**

Insert `$e^{i\pi}$`, put cursor inside. The `$` delimiters should be monospace (already are via `.tok-meta`). The `e^{i\pi}` content should now also be monospace.

Also test display math `$$...$$` to make sure it works there too.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/render/math-render.test.ts`
Expected: No regressions (math decorations are tested).

Run: `npx vitest run`
Expected: No regressions in full suite.

- [ ] **Step 6: Commit**

```bash
git add src/render/math-render.ts src/editor/typography-theme.ts
git commit -m "style: make math LaTeX source monospace when editing (#267)"
```

---

### Task 3: Fenced div fence syntax monospace

**Files:**
- Modify: `src/plugins/plugin-render.ts`
- Modify: `src/editor/typography-theme.ts` (if CSS not already added)

When cursor is on a fenced div fence (source mode, `cg-block-source`), the syntax tokens (`::: {.class #id}`) need monospace marks. The title text after `}` stays in its natural font.

The Lezer tree provides exact node positions:
- `FencedDivFence` — covers the `:::` colons
- `FencedDivAttributes` — covers `{.class #id key=value}`
- `FencedDivTitle` — covers the title text after `}`

We mark FencedDivFence and FencedDivAttributes with monospace; we leave FencedDivTitle unmarked.

- [ ] **Step 1: Add CSS for `cg-source-syntax` (if not already present)**

In `src/editor/typography-theme.ts`, add:

```typescript
/* Source syntax tokens (fenced div fences, attributes) when editing */
".cg-source-syntax": {
    fontFamily: monoFont,
    color: "var(--cg-muted)",
},
```

The `color: "var(--cg-muted)"` makes the syntax visually recede (like heading `#` markers), distinguishing it from the prose title.

- [ ] **Step 2: Add mark decorations in source mode**

In `src/plugins/plugin-render.ts`, in the `cursorOnEitherFence` branch of `buildBlockDecorations` (around line 465), after the line decoration for `cg-block-source`, add mark decorations:

```typescript
if (cursorOnEitherFence) {
    items.push(
        Decoration.line({
            class: `${spec.className} cg-block-source`,
        }).range(div.from),
    );
    // Mark fence colons and attributes as monospace source syntax
    // FencedDivFence covers the ::: colons
    if (div.openFenceFrom < div.openFenceTo) {
        // Find the fence-only range (before attributes and title)
        // Use attrFrom or titleFrom to determine where the fence syntax ends
        const fenceSyntaxEnd = div.attrTo ?? div.attrFrom ?? div.openFenceFrom;
        // Mark from start of line to end of attributes (or end of fence colons)
        // The FencedDivFence node just covers the :::, and attrTo covers {.class}
        // We need both marked as monospace
    }
}
```

Actually, the simpler approach: use the `FencedDivInfo` fields directly.

The `div` has `openFenceFrom`, `attrFrom`, `attrTo`, `titleFrom`. The syntax portion is from `openFenceFrom` to `attrTo` (covers `::: {.class #id}`). If there's a space between `}` and the title, it's between `attrTo` and `titleFrom`.

```typescript
if (cursorOnEitherFence) {
    items.push(
        Decoration.line({
            class: `${spec.className} cg-block-source`,
        }).range(div.from),
    );
    // Mark fence syntax (:::) + attributes ({.class}) as monospace
    const syntaxEnd = div.attrTo ?? div.openFenceTo;
    if (div.openFenceFrom < syntaxEnd) {
        items.push(
            Decoration.mark({ class: "cg-source-syntax" }).range(div.openFenceFrom, syntaxEnd),
        );
    }
    // Also mark closing fence ::: as monospace when shown
    // (closing fence is on a separate line, handled below)
}
```

For the closing fence line (in the closing fence source mode branch, around line 488):

```typescript
if (cursorOnEitherFence) {
    if (!div.singleLine && div.closeFenceFrom >= 0) {
        items.push(
            Decoration.line({
                class: `${spec.className} cg-block-source`,
            }).range(div.closeFenceFrom),
        );
        // Mark closing ::: as monospace
        items.push(
            Decoration.mark({ class: "cg-source-syntax" }).range(div.closeFenceFrom, div.closeFenceTo),
        );
    }
}
```

- [ ] **Step 3: Verify in browser**

Insert `::: {.theorem} Main Result\nContent.\n:::`, put cursor on the opening fence. The `::: {.theorem}` portion should be monospace and muted color. `Main Result` should stay in its natural font. The closing `:::` should also be monospace.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/plugins/plugin-render.test.ts`
Expected: No regressions.

Run: `npx vitest run`
Expected: No regressions.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/plugin-render.ts src/editor/typography-theme.ts
git commit -m "style: make fenced div syntax monospace when editing (#267)"
```

---

### Task 4: Browser verification of all gaps

**Files:** None (testing only)

- [ ] **Step 1: Start dev server and Chrome**

Run: `npm run dev` and `npm run chrome`

- [ ] **Step 2: Test math source**

Insert `$e^{i\pi} + 1 = 0$`, put cursor inside. Verify:
- `$` delimiters: monospace (should already work)
- `e^{i\pi} + 1 = 0`: monospace (new)
- Move cursor out: rendered KaTeX (no monospace visible)

- [ ] **Step 3: Test link URLs**

Insert `[click here](https://example.com)`, put cursor inside. Verify:
- `[`, `]`, `(`, `)`: monospace (should already work)
- `click here`: serif (prose, stays natural)
- `https://example.com`: monospace (new)

- [ ] **Step 4: Test fenced div fences**

Insert `::: {.theorem} Main Result\nBody text.\n:::`, put cursor on opening fence. Verify:
- `::: {.theorem}`: monospace, muted color (new)
- `Main Result`: natural font (unchanged)
- Closing `:::`: monospace, muted color (new)

- [ ] **Step 5: Test headers (regression check)**

Insert `# Main Section`, put cursor inside. Verify `#` is monospace and heading text is serif. (Should still work.)

- [ ] **Step 6: Test bold/italic markers (regression check)**

Insert `**bold** and *italic*`, put cursor inside bold. Verify `**` is monospace, `bold` is serif with bold weight. (Should still work.)

---

## Summary

| Gap | Fix | Files |
|-----|-----|-------|
| Link URLs | CSS: add `.tok-url` to monospace rule | typography-theme.ts |
| Math LaTeX content | Mark decoration: `cg-math-source` when cursor inside | math-render.ts, typography-theme.ts |
| Fenced div fence syntax | Mark decoration: `cg-source-syntax` on fence + attrs | plugin-render.ts, typography-theme.ts |

Net result: All non-prose source syntax renders in monospace when editing. Subsumes #267 and #264.
