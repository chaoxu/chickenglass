# Coflat Document Format

Pandoc-flavored markdown with custom extensions for mathematical writing. This document specifies the exact input format the editor expects.

## Frontmatter

YAML block delimited by `---`. All fields optional.

```yaml
---
title: Document Title
bibliography: reference.bib
csl: style.csl
numbering: global
imageFolder: images
math:
  \R: "\\mathbb{R}"
  \N: "\\mathbb{N}"
blocks:
  claim:
    title: Claim
    counter: theorem
---
```

| Key | Type | Description |
|-----|------|-------------|
| `title` | string | Document title (rendered as H1 widget) |
| `bibliography` | string | Path to `.bib` file (relative to document) |
| `csl` | string | Path to CSL style file |
| `numbering` | `"global"` \| `"grouped"` | Block numbering scheme. `global`: all numbered blocks share one counter. `grouped`: each type has its own. |
| `math` | map | KaTeX macro definitions (`\command: "expansion"`) |
| `blocks` | map | Custom block definitions and overrides (`title`, `numbered`, `counter`, enable/disable) |
| `imageFolder` | string | Default folder for pasted/dropped images. Also accepts `image-folder`. |

Project-level config in `coflat.yaml` uses the same keys. File frontmatter overrides project config. Math macros merge additively (file adds to project).

## Text Formatting

| Syntax | Renders as |
|--------|-----------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | `code` (monospace) |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `==highlight==` | highlighted text |
| `[text](url)` | hyperlink |
| `![alt](src)` | image |

Backtick-quoted text (`` `...` ``) renders as plain monospace — no background or badge. In mathematical writing this corresponds to `\texttt{}` in LaTeX: a font switch, not a code block. The same syntax can mean either "inline code" or "monospace emphasis" depending on context; Coflat does not distinguish between them.

## Headings

ATX headings (`#` through `######`). Auto-numbered unless marked unnumbered. Explicit heading IDs are supported via trailing Pandoc attributes and can be cross-referenced.

```markdown
# Numbered Heading              --> "1. Numbered Heading"
## Subsection                   --> "1.1. Subsection"
# Another Section               --> "2. Another Section"

# Unnumbered Heading {-}        --> no number
## Also Unnumbered {.unnumbered} --> no number
## Background {#sec:background} --> cross-ref target "Section 1.1"
```

Trailing Pandoc attribute blocks are supported on headings. The editor currently uses them primarily for `#id`, `{-}`, and `{.unnumbered}`. These attributes are hidden when the cursor is outside the heading.

## Math

Four delimiter styles, all producing the same KaTeX output:

### Inline math

```
$e^{i\pi} + 1 = 0$
\(e^{i\pi} + 1 = 0\)
```

### Display math

```
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

\[
\sum_{k=0}^n \binom{n}{k} = 2^n
\]
```

Display math can interrupt a paragraph (no blank line required before `$$` or `\[`).

### Equation labels

Append `{#eq:label}` after the closing `$$` or `\]`:

```
$$
E = mc^2
$$ {#eq:einstein}
```

Equations are numbered sequentially across the document. Reference with `[@eq:einstein]`.

### Custom macros

Define in frontmatter under `math:`. Available in all math expressions:

```yaml
math:
  \R: "\\mathbb{R}"
  \set: "\\left\\{#1\\right\\}"
```

Usage: `$x \in \R$`, `$\set{1,2,3}$`.

## Fenced Divs

Pandoc-style fenced divs for semantic blocks. Minimum 3 colons.

### Basic syntax

```markdown
::: {.theorem}
Content here.
:::
```

### With ID, class, and title

```markdown
::: {#thm:main .theorem} Main Result
Statement of the theorem with $math$.
:::
```

The title text after `}` supports full inline markdown (bold, italic, math, code). For standard above-header blocks, the title appears parenthesized after the block label: **Theorem 1** (Main Result). For `figure` and `table` blocks, the title/caption is rendered below the content.

Attributes inside `{...}`:
- `.classname` -- block type (required, first class is the primary type)
- `#id` -- cross-reference ID
- `key="value"` -- key-value attributes (e.g., `title="Alternative Title"`)
- Multiple classes: `{.theorem .important}` (first is the block type)

If no inline title text is present after `}`, `title="..."` acts as an attribute-only title fallback. If both are present, the inline title wins.

### Short form

First word is the class, rest is the title:

```markdown
::: Theorem Main Result
Content.
:::
```

Equivalent to `::: {.theorem} Main Result`.

### Self-closing

Single-line fenced divs:

```markdown
::: {.theorem} Short statement. :::
```

### Nesting

Use more colons for outer divs:

```markdown
::::: {.theorem}
Statement.

:::: {.proof}
Proof content.
::::
:::::
```

The inner block must use fewer colons than the outer.

Same-colon nesting is not supported. For example, this is invalid and will parse incorrectly:

```markdown
::: {.theorem}
::: {.proof}
...
:::
:::
```

Use `::::` for the outer block and `:::` for the inner block instead.

The parser uses a generation counter to prevent incremental fragment reuse across composite block boundaries.

### Built-in block types

| Type | Counter group | Body style | Special behavior |
|------|--------------|-----------|-----------------|
| `theorem` | theorem | italic | -- |
| `lemma` | theorem | italic | -- |
| `corollary` | theorem | italic | -- |
| `proposition` | theorem | italic | -- |
| `conjecture` | theorem | italic | -- |
| `definition` | definition | normal | -- |
| `problem` | theorem | normal | -- |
| `example` | -- (unnumbered) | normal | -- |
| `remark` | -- (unnumbered) | normal | -- |
| `proof` | -- (unnumbered) | normal | QED tombstone at end |
| `algorithm` | algorithm | normal | -- |
| `figure` | figure | normal | caption rendered below content |
| `table` | table | normal | caption rendered below content |
| `blockquote` | -- (unnumbered) | normal | header label hidden |
| `embed` | -- | -- | renders iframe |
| `iframe` | -- | -- | renders iframe |
| `youtube` | -- | -- | YouTube embed |
| `gist` | -- | -- | GitHub Gist embed |
| `include` | -- | -- | file inclusion (special, not a plugin) |

Counter groups: blocks sharing a counter group are numbered together. E.g., Theorem 1, Lemma 2, Corollary 3 all share the "theorem" counter.

Typical numbered figure/table usage:

```markdown
::: {.figure #fig:architecture} System overview
![System overview](architecture.png)
:::

::: {.table #tbl:runtime} Running times
| Algorithm | Time |
|-----------|------|
| Quicksort | $O(n \log n)$ |
:::
```

### Custom block types

Define in frontmatter:

```yaml
blocks:
  claim:
    title: Claim
    counter: theorem    # share counter with theorem family
  axiom:
    title: Axiom
    counter: axiom      # own counter group
```

`blocks:` entries can be:
- `false` -- disable a built-in block type for this document
- `true` -- explicitly enable an existing block type
- an object with:
  - `title` -- override the rendered label
  - `numbered` -- enable/disable numbering for that block type
  - `counter` -- shared counter group name
  - `counter: null` -- remove an inherited shared group and use the block's own counter

## Cross-References

Reference any fenced block, heading, or equation by its `#id` attribute.

### Bracketed (rendered inline)

```markdown
See [@thm:main] for the proof.     --> "See Theorem 1 for the proof."
By [@eq:einstein], energy is...     --> "By Eq. (1), energy is..."
See [@sec:background].             --> "See Section 1.1."
```

### Narrative (bare @)

```markdown
@thm:main shows that...             --> "Theorem 1 shows that..."
```

### Clusters

Multiple references can be clustered with `;`. Each item is resolved independently, so mixed cross-reference/citation clusters are supported:

```markdown
[@thm:main; @eq:einstein]
[@eq:einstein; @karger2000]
```

Resolution order: fenced blocks (by fenced div `#id`) -> equations (by `{#eq:id}`) -> headings (by heading `#id`) -> citations (by bib key). If an ID matches a fenced block, it takes priority over a citation with the same key.

## Citations

Require a `.bib` file specified in frontmatter `bibliography:` or project `coflat.yaml`.

### Parenthetical

```markdown
See [@karger2000] for details.
Results from [@karger2000; @stein2001].
```

### With locators

```markdown
[@karger2000, p. 42]
[@karger2000, Theorem 3; @stein2001, Ch. 2]
```

### Narrative

```markdown
@karger2000 showed that...          --> "Karger (2000) showed that..."
```

Citation formatting depends on the CSL style. Default: IEEE numeric (`[1]`, `[2]`). A bibliography section is automatically appended at the end of the document listing all cited entries.

## Footnotes

```markdown
This has a footnote[^1].

[^1]: This is the footnote content with math $x^2$.
```

Footnote IDs can be any string: `[^note]`, `[^long-id]`. Rendered as sidenotes in the margin when space allows. Footnote definitions can appear anywhere in the document.

## Code Blocks

Fenced code blocks only. **Indented code blocks are disabled** (4-space indent is cosmetic only, does not create a code block).

````markdown
```haskell
fibonacci :: Int -> Int
fibonacci 0 = 0
fibonacci n = fibonacci (n-1) + fibonacci (n-2)
```
````

Language tag after opening fence enables syntax highlighting.

## Tables

Pipe-delimited tables with optional alignment:

```markdown
| Algorithm | Time          | Space       |
|-----------|---------------|-------------|
| Quicksort | $O(n \log n)$ | $O(\log n)$ |
| Mergesort | $O(n \log n)$ | $O(n)$      |
```

Alignment: `|:---|` left, `|:---:|` center, `|---:|` right. Math works inside table cells.

## Lists

Ordered, unordered, and task lists. Math works inside list items:

```markdown
1. First item with $O(n \log n)$
2. Display math in list:
   $$
   T(n) = 2T(n/2) + O(n)
   $$

- Bullet with macros: $\R$, $\N$, $\Z$
- [ ] Unchecked task
- [x] Checked task
```

## Embeds

### GitHub Gist

```markdown
::: {.gist}
https://gist.github.com/user/hash
:::
```

### Generic iframe

```markdown
::: {.embed}
https://example.com/widget
:::
```

### YouTube

```markdown
::: {.youtube}
https://www.youtube.com/watch?v=dQw4w9WgXcQ
:::
```

## Include Blocks

Include content from another file:

```markdown
::: {.include}
chapters/introduction.md
:::
```

The included file's content replaces the block seamlessly. Paths are relative to the current document. Included files are re-read on change.

## Removed Features

These standard markdown features are **intentionally disabled**:

| Feature | Reason | Alternative |
|---------|--------|-------------|
| Indented code blocks | Conflicts with fenced div content indentation | Use fenced code blocks (```) |
| `>` blockquotes | Limited (no math, no nesting with fenced divs) | Use `::: Blockquote` fenced divs |

The read/export pipeline still parses standard `>` blockquotes for compatibility with imported markdown, but the editor authoring format does not use them.

## Horizontal Rules

```markdown
---
```

Three or more hyphens on a line. Must not be at the start of the document (where `---` is frontmatter). A blank line before `---` distinguishes it from frontmatter.
