# Coflat Markdown Format

Coflat uses Pandoc-flavored markdown with the following specifics.

## Math

- Inline math: `$...$` or `\(...\)`
- Display math: `$$...$$` or `\[...\]`
- Equation labels: `$$ ... $$ {#eq:label}`
- LaTeX environments (`\begin{align*}`, etc.) must be wrapped in `$$` or `\[...\]`
- Escaped dollar sign: `\$` renders as `$`

## Fenced Divs

Semantic block containers using `:::` fences:

```
::: Theorem Optional Title
Content (parsed as full markdown).
:::

::: Proof
Proof content with QED tombstone.
:::
```

Supported block types: Theorem, Lemma, Corollary, Conjecture, Proposition, Definition, Problem, Remark, Example, Algorithm, Proof, Blockquote.

Attribute syntax: `::: {.class #id key=val} Title`

Nesting is supported — fenced divs can contain other fenced divs.

## Headings

ATX headings only (`#`, `##`, etc.). No setext (underline) headings.

Pandoc attributes: `## Heading {#id .class -}` where `-` or `.unnumbered` suppresses section numbering.

## Code Blocks

Fenced code blocks only (`` ``` ``). Indented code blocks are disabled.

Language label: `` ```python ``

## Footnotes

- Definition: `[^id]: content`
- Reference: `[^id]`

## Citations and Cross-References

- Parenthetical citation: `[@key]` or `[@key1; @key2]`
- Narrative citation: `@key`
- Cross-reference: `[@thm:label]`, `[@eq:label]`
- Citation keys may contain letters, digits, `_`, `:`, `.`, `-`, `/`

## Escape Characters

- `\$` → `$` (literal dollar sign, not math delimiter)
- `\*` → `*`, `\_` → `_`, etc. (standard markdown escapes)

## Lists

- Unordered: `-`, `*`, `+`
- Ordered: `1.`, `2.`, etc.
- Task lists: `- [ ]`, `- [x]`

## Tables

GitHub-flavored markdown (GFM) pipe tables with alignment:

```
| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |
```

## Inline Formatting

- Bold: `**text**`
- Italic: `*text*`
- Strikethrough: `~~text~~`
- Highlight: `==text==`
- Inline code: `` `code` ``
- Links: `[text](url)`
- Images: `![alt](url)`

## Frontmatter

YAML frontmatter between `---` delimiters:

```yaml
---
title: Document Title
tags: tag1, tag2
bibliography: reference.bib
csl: style.csl
math:
  \R: \mathbb{R}
  \N: \mathbb{N}
numbering: true
---
```

## Blockquotes

Standard `>` blockquotes are **disabled**. Use `::: Blockquote` fenced divs instead.

## Not Supported

- Indented code blocks (use fenced `` ``` `` instead)
- `>` blockquotes (use `::: Blockquote` instead)
- Setext headings (use `#` ATX headings)
