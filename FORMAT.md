# Coflat Document Format

Pandoc Markdown with a fixed set of Pandoc extensions and pandoc-crossref conventions for mathematical writing. This document specifies the canonical input format the editor expects.

Canonical documents must be parseable by Pandoc. Coflat semantics are encoded with Pandoc-native constructs such as YAML metadata, fenced divs, attributes, citations, raw LaTeX, and tables, plus pandoc-crossref-style labels for equations and cross-references. Non-Pandoc authoring sugar is not part of the canonical format.

The canonical reader profile is:

```text
markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark
```

The canonical filter profile runs `pandoc-crossref` before `citeproc` when exporting through Pandoc, because equation, figure, table, and block references use citation-like syntax.

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
latex:
  template: article
  bibliography: reference.bib
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
| `latex` | map | LaTeX export options. Supported keys: `template`, `bibliography`. |
| `blocks` | map | Custom block definitions and overrides (`title`, `numbered`, `counter`, enable/disable) |
| `imageFolder` | string | Default folder for pasted/dropped images. Also accepts `image-folder`. |

Project-level config in `coflat.yaml` uses the same keys. File frontmatter overrides project config. Math macros merge additively (file adds to project).

### Publisher metadata

Fields consumed by the LaTeX export pipeline (e.g. LIPIcs, LNCS). The editor ignores unknown keys; exporters preserve supported metadata in frontmatter and pass it through the pre-pandoc pipeline.

```yaml
---
title: Main Title
titlerunning: Short title for running head
authorrunning: Short author line
copyright: Firstname Lastname and coauthors
category: Track A
relatedversion: "A full version at https://arxiv.org/abs/..."
acknowledgements: "We thank ..."
funding: "NSF grant ..."
keywords:
  - keyword one
  - keyword two
ccsdesc:
  - weight: 500
    text: "Theory of computation → Graph algorithms"
authors:
  - name: First Author
    affiliation: University A, Country
    email: first@example.org
    orcid: 0000-0000-0000-0000
    funding: "Supported by grant X"
---
```

| Key | Type | Description |
|-----|------|-------------|
| `titlerunning` | string | Short title for running head |
| `authorrunning` | string | Short author line for running head |
| `copyright` | string | Rendered into publisher copyright block |
| `category` | string | Track / session label |
| `relatedversion` | string | Preprint or extended-version pointer |
| `acknowledgements` | string | Plain text, before bibliography |
| `funding` | string | Document-level funding statement |
| `keywords` | list of string | Keyword list |
| `ccsdesc` | list of `{weight, text}` | ACM CCS subject descriptors (higher weight → more prominent) |
| `authors` | list of author objects | Per-author `name`, `affiliation`, `email`, `orcid`, `funding` |

These fields are not rendered in the live editor surface. They flow only through the LaTeX export.

## Text Formatting

| Syntax | Renders as |
|--------|-----------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | `code` (monospace) |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `==highlight==` | highlighted text (Pandoc `mark` extension) |
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

### Labeled equations

Unlabeled display math uses `$$...$$` or `\[...\]`. Labeled equations use the pandoc-crossref display-math label convention:

```markdown
$$
E = mc^2
$$ {#eq:einstein}
```

The label must use the `eq:` prefix. Pandoc core parses `{#eq:einstein}` as ordinary text after the math block; Coflat treats this as canonical because pandoc-crossref recognizes it and resolves `[@eq:einstein]` when the filter runs before citeproc. Raw LaTeX `\begin{equation}\label{eq:...}...\end{equation}` is allowed as raw TeX, but it is not the canonical Coflat equation-label syntax.

Equation labels must be unique within a document. Duplicate `{#eq:id}` labels are accepted by the parser but flagged by the semantic index; cross-references to the duplicated id resolve as ambiguous.

**Escape rules.** A literal dollar sign in prose is written `\$` and does not open inline math. Inside `$...$` inline math, a backslash escapes the following character, so `$ \$50 $` is a math span containing a literal `$`. Display math `\[...\]` and inline math `\(...\)` are the LaTeX-style alternative syntaxes for `$$...$$` and `$...$`; the same backslash-escape applies to their contents. Dollar-math is suppressed inside fenced code blocks and inline code spans.

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
::: {.theorem #thm:main title="Main Result"}
Statement of the theorem with $math$.
:::
```

The title is a Pandoc attribute. It is plain text, not inline markdown. For standard above-header blocks, the title appears parenthesized after the block label: **Theorem 1** (Main Result). For `figure`, `table`, and `algorithm` blocks, the title becomes the caption.

Attributes inside `{...}`:
- `.classname` -- block type (required, first class is the primary type)
- `#id` -- cross-reference ID
- `key="value"` -- key-value attributes (e.g., `title="Alternative Title"`)
- Multiple classes: `{.theorem .important}` (first is the block type)

Trailing title text after the attribute block, such as `::: {.theorem} Main Result`, is not canonical because Pandoc does not parse it as part of the div.

### Class shorthand

Pandoc supports a class-only shorthand when no ID or title is needed:

```markdown
::: theorem
Content.
:::
```

This is equivalent to `::: {.theorem}`. It cannot carry a title.

### No self-closing blocks

Fenced divs must use explicit opener and closer lines:

```markdown
::: {.theorem}
Short statement.
:::
```

Single-line self-closing divs such as `::: {.theorem} Short statement. :::` are not canonical because Pandoc treats them as unclosed divs or literal paragraph text.

### Nesting

Use more colons for outer divs:

```markdown
:::: {.theorem title="Outer result"}
Statement.

::: {.proof}
Proof content.
:::
::::
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

Counter groups: blocks sharing a counter group are numbered together. E.g., Theorem 1, Lemma 2, Corollary 3 all share the "theorem" counter.

Typical numbered figure/table usage:

```markdown
::: {.figure #fig:architecture title="System overview"}
![System overview](architecture.png)
:::

::: {.table #tbl:runtime title="Running times"}
| Algorithm | Time |
|-----------|------|
| Quicksort | $O(n \log n)$ |
:::
```

#### Multi-image figures (subfigures)

A figure div may contain more than one image. Each image becomes a subfigure in LaTeX (`\subfigure` / `\subcaptionbox`). Alt text per image is used as the subcaption:

```markdown
::: {.figure #fig:compare title="Before and after"}
![Before](before.png)
![After](after.png)
:::
```

#### Algorithm body

Algorithm blocks use a fenced code block (language `text` or none) for the pseudocode body. The exporter lifts the body verbatim into a LaTeX `algorithm` environment; the div's `title` attribute becomes the `\caption`:

````markdown
::: {.algorithm #alg:dijkstra title="Shortest paths"}
```text
Input: graph G, source s
Output: distances d[v]
  for each v in V: d[v] <- infinity
  d[s] <- 0
  ...
```
:::
````

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

Reference fenced blocks and headings by their `#id` attribute. Reference labeled equations by their pandoc-crossref `{#eq:...}` display-math label.

> **Parser vs. semantics scope.** `[@id]` and `@id` are not tokenized by Coflat's markdown parser; they appear in the syntax tree as ordinary text (matching Pandoc core, which leaves them for `pandoc-crossref` and `citeproc` to resolve). The reference index, renderer, and LaTeX exporter recognize and resolve them as a downstream semantic pass. Tooling that needs to highlight or rewrite these tokens should run against the semantic index, not the parse tree.

### ID prefixes

IDs are conventionally prefixed by target kind. The LaTeX exporter uses these prefixes to route `[@id]` to `\cref{id}` vs `\cite{id}`:

| Prefix | Target |
|--------|--------|
| `sec:` | heading |
| `thm:` | theorem |
| `lem:` | lemma |
| `cor:` | corollary |
| `prop:` | proposition |
| `def:` | definition |
| `eq:` | equation |
| `fig:` | figure |
| `tbl:` | table |
| `alg:` | algorithm |

Any other bare key (e.g. `karger2000`) is treated as a citation key. IDs with unrecognized prefixes still resolve if they match a fenced block `#id`.

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

Resolution order: fenced blocks (by fenced div `#id`) -> equations (by display-math `{#eq:id}`) -> headings (by heading `#id`) -> citations (by bib key). If an ID matches a fenced block, it takes priority over a citation with the same key.

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

### Line breaks inside cells

Inline `<br>` forces a visible line break inside a cell. The LaTeX exporter maps `<br>` in a cell to `\newline` (within a `tabularx` column).

```markdown
| Case | Notes |
|------|-------|
| A    | first line<br>second line |
```

### Grid tables

Grid tables (pandoc `grid_tables`) are accepted as Pandoc-compatible raw/source blocks for cells that need multiple paragraphs or block content. Coflat preserves the grid-table source range for import/export and source-boundary operations, but grid tables are not parsed into Coflat's semantic live table model. Use pipe tables for editable semantic tables.

```markdown
+-------+------------------+
| Input | Output           |
+=======+==================+
| graph | first paragraph  |
|       |                  |
|       | second paragraph |
+-------+------------------+
```

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

## Removed Features

These standard markdown features are **not canonical**, even if Pandoc's markdown reader can parse some of them:

| Feature | Reason | Alternative |
|---------|--------|-------------|
| Indented code blocks | Conflicts with fenced div content indentation | Use fenced code blocks |
| `>` blockquotes | Limited (no math, no nesting with fenced divs) | Use `::: {.blockquote}` fenced divs |
| Pandoc definition lists (`Term` followed by `: Definition`) | Not part of the Coflat semantic model | Use `::: {.definition}` fenced divs for mathematical definitions, or ordinary lists/tables for glossaries |
| Raw inline HTML (`<br>`, `<sub>`, `<sup>`, etc.) | Coflat's reader does not enable Pandoc's `+raw_html`; rendering pure-Pandoc markdown only | Use `\\` for line breaks in math; use raw LaTeX (`\textsubscript{...}`) for sub/superscript outside math |
| HTML comments (`<!-- ... -->`) | Not part of the canonical Coflat surface; not hidden in render | Strip before authoring, or use a `::: {.remark}` block |
| Reference-style links (`[text][id]` with `[id]: url` definitions) | Authors should use inline `[text](url)` form to keep one source location per link | Inline links `[text](url)` |
| Bare URL autolink (`https://example.com` without brackets) | Pandoc's `+autolink_bare_uris` is not enabled | Wrap in `[https://example.com](https://example.com)` or `<https://example.com>` |

The read/export pipeline still parses standard `>` blockquotes for compatibility with imported markdown, but the editor authoring format does not use them.

## Horizontal Rules

```markdown
---
```

Three or more hyphens on a line. Must not be at the start of the document (where `---` is frontmatter). A blank line before `---` distinguishes it from frontmatter.

## LaTeX Export

The LaTeX export pipeline (`scripts/export-latex.mjs`, desktop PDF/LaTeX export, `src/latex/`) emits a compilable `.tex` or `.pdf` file from a canonical Coflat Markdown document. The stages are:

1. **Prepare metadata** — preserve root frontmatter as Pandoc metadata and hoist supported export-only fields such as `math:` into Pandoc-compatible metadata.
2. **Pandoc** — invoked as:

   ```text
   pandoc --from markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark \
          --to latex --wrap=preserve --syntax-highlighting=none \
          --lua-filter=src/latex/filter.lua \
          --template=src/latex/template/<variant>.tex \
          --metadata=bibliography=<bib-name-without-.bib> \
          --output=out/<doc>.tex
   ```

3. **Compile** — `latexmk -pdf out/<doc>.tex` (optional; separate target).

### Block vocabulary mapping

Each built-in block maps to a LaTeX environment. Unknown classes are passed through as raw text.

| Fenced div class | LaTeX environment | Notes |
|------------------|-------------------|-------|
| `.theorem` | `theorem` | |
| `.lemma` | `lemma` | |
| `.corollary` | `corollary` | |
| `.proposition` | `proposition` | |
| `.conjecture` | `conjecture` | Requires `\newtheorem{conjecture}` |
| `.definition` | `definition` | |
| `.problem` | `problem` | |
| `.example` | `example` | |
| `.remark` | `remark` | |
| `.proof` | `proof` | |
| `.algorithm` | `algorithm` | Body becomes pseudocode; title → `\caption`, `#id` → `\label` |
| `.figure` | `figure` | Multi-image → subfigures |
| `.table` | `table` + `tabularx` | Supports `<br>` → `\newline`, grid tables → multi-paragraph cells |
| `.blockquote` | `quote` | |

### Inline mapping

| Coflat markdown | LaTeX |
|-----------------|-------|
| `$...$` | `\(...\)` |
| `\(...\)` | `\(...\)` (passthrough) |
| `$$...$$` (unlabeled) | `\[...\]` |
| `$$...$$ {#eq:id}` | labeled equation via pandoc-crossref |
| `==highlight==` | `\hl{highlight}` (requires `\usepackage{soul}`) |
| `[@id]` where `id` begins with an xref prefix | `\cref{id}` |
| `[@id]` otherwise | `\cite{id}` |
| `@id` where `id` begins with an xref prefix | `\cref{id}` (narrative form) |
| `- [ ] task` / `- [x] done` | `\item[$\square$]` / `\item[$\boxtimes$]` inside `itemize` |
| `<br>` inside a table cell | `\newline` |
| `<br>` outside a table | `\\` |

### Math macro injection

Frontmatter `math:` entries become `\newcommand` declarations in the preamble. The exporter detects argument arity by scanning the RHS for `#1`, `#2`, ...:

```yaml
math:
  R: "\\mathbb{R}"
  floor: "\\lfloor #1 \\rfloor"
```

→

```latex
\newcommand{\R}{\mathbb{R}}
\newcommand{\floor}[1]{\lfloor #1 \rfloor}
```

The LaTeX importer recognizes the same exported `\newcommand` shape, plus
`\renewcommand`, `\def`, `\let`, and `\DeclareMathOperator`, and maps used
macros back into frontmatter `math:`.

### Template variants

- `template/article.tex` — plain `\documentclass{article}` fallback with `amsthm`, `cleveref`, `soul`, `tabularx`, `booktabs`, `algorithm`, `hyperref`.
- `template/lipics.tex` — LIPIcs submissions; consumes the Publisher metadata frontmatter (authors, ccsdesc, keywords, copyright, titlerunning, authorrunning, funding, acknowledgements, category, relatedversion).

Select a variant with `scripts/export-latex.mjs --template lipics` or by setting `latex.template: lipics` in frontmatter. `latex.bibliography` overrides the top-level `bibliography` value for LaTeX export; command-line `--template` and `--bibliography` flags override frontmatter in the CLI.
