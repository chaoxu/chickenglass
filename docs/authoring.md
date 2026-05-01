# Authoring Guide

How to write mathematical documents in Coflat. For the canonical document
format see [FORMAT.md](../FORMAT.md); this guide is task-oriented and covers
the editor and app behavior around it.

## Quick start

```bash
pnpm install
pnpm dev          # browser app at http://localhost:5173
pnpm tauri:dev    # desktop app (needs Rust toolchain)
```

The browser build is fully usable for writing but cannot export. Export
features (PDF / LaTeX / HTML via Pandoc) require the desktop app.

To write a document:

1. Open a project folder. In the desktop app use **File &rarr; Open Project**;
   in the browser the demo project is loaded automatically.
2. Create or pick a `.md` file from the file tree.
3. Start writing in CM6 rich mode (the default). Switch modes from the editor
   header if you want raw markdown.

## Writing math

Inline:

```markdown
The identity $e^{i\pi} + 1 = 0$ is famous.
Or in LaTeX form: \(e^{i\pi} + 1 = 0\).
```

Display:

```markdown
$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$
```

Labeled equations use the pandoc-crossref convention:

```markdown
$$
E = mc^2
$$ {#eq:einstein}
```

Reference them as `[@eq:einstein]`. Math is rendered by KaTeX, so any KaTeX
limitation applies (no `\newcommand` mid-document; define macros in
frontmatter `math:` instead). See FORMAT.md &sect; Math for full delimiter
rules and escaping.

To define document-wide macros:

```yaml
---
math:
  \R: "\\mathbb{R}"
  \set: "\\left\\{#1\\right\\}"
---
```

## Theorem-like blocks

Coflat semantic blocks are Pandoc fenced divs:

```markdown
::: {.theorem #thm:main title="Main result"}
For every $n \ge 1$, $\sum_{k=1}^n k = n(n+1)/2$.
:::

::: {.proof}
By induction on $n$.
:::
```

Built-in block types include `theorem`, `lemma`, `corollary`, `proposition`,
`conjecture`, `definition`, `problem`, `example`, `remark`, `proof`,
`algorithm`, `figure`, `table`, and `blockquote`. The full counter / styling
table is in [FORMAT.md &sect; Fenced Divs](../FORMAT.md#fenced-divs).

Define custom block types in frontmatter:

```yaml
blocks:
  claim:
    title: Claim
    counter: theorem    # share counter group with theorems
```

Nesting: outer divs need more colons than inner ones. Use `::::` then `:::`.

## Cross-references

Reference fenced blocks, headings, and labeled equations by their id:

```markdown
See [@thm:main] and [@eq:einstein].
By @thm:main, the sum is closed form.
```

Heading ids are added with a trailing attribute:

```markdown
## Background {#sec:background}
```

Conventional id prefixes (`thm:`, `lem:`, `cor:`, `prop:`, `def:`, `eq:`,
`fig:`, `tbl:`, `alg:`, `sec:`) drive how the LaTeX exporter routes them
(`\cref` vs `\cite`).

## Citations

Add a bibliography file and (optionally) a CSL style in frontmatter:

```yaml
---
bibliography: reference.bib
csl: ieee.csl
---
```

Cite by bib key:

```markdown
See [@karger2000] for details.
[@karger2000, p. 42; @stein2001, Ch. 2]
@karger2000 showed that ...
```

Bare keys without a known cross-reference prefix are treated as citations.
Default formatting is IEEE numeric. A bibliography section is appended to the
end of the document automatically.

## Media

Images use ordinary markdown:

```markdown
![System overview](images/architecture.png)
```

Paths are resolved relative to the document. Set a default folder for pasted
or dropped images:

```yaml
---
imageFolder: images
---
```

Multi-image figures become subfigures in LaTeX:

```markdown
::: {.figure #fig:compare title="Before and after"}
![Before](before.png)
![After](after.png)
:::
```

PDFs and other binary assets next to the document are linked the same way.
The standalone editor and Tauri shell render local image and PDF previews;
remote URLs are fetched if the runtime allows.

## Tables

Pipe-delimited tables, with optional alignment:

```markdown
| Algorithm | Time          | Space       |
|-----------|---------------|-------------|
| Quicksort | $O(n \log n)$ | $O(\log n)$ |
| Mergesort | $O(n \log n)$ | $O(n)$      |
```

For a numbered, captioned table use a `.table` fenced div:

```markdown
::: {.table #tbl:runtime title="Running times"}
| Algorithm | Time          |
|-----------|---------------|
| Quicksort | $O(n \log n)$ |
:::
```

Inline `<br>` forces a line break inside a cell. Grid tables are accepted as
Pandoc-compatible source for cells with multi-paragraph content but are not
edited as live tables in CM6 rich mode.

## Save and recovery

- **Autosave** runs on a 30-second debounce by default and on blur. Adjust
  the interval in Settings, or set the interval to 0 to require manual save.
- **Save now**: `Cmd/Ctrl+S` flushes the active document immediately.
- **Hot-exit backups**: unsaved edits are persisted to a local backup store
  on a debounce so an unexpected exit does not lose work. On reopen, Coflat
  restores the dirty buffer and shows it as unsaved.
- **External-conflict banner**: if a file changes or is deleted on disk while
  you have unsaved local edits, Coflat shows a banner with three actions:
  *keep local edits*, *discard local edits and reload*, or *merge*. The
  filesystem watcher detects external edits live in the desktop app.
- **Dirty-confirm dialog**: switching files with unsaved changes prompts for
  confirmation in production. Dev mode skips this dialog by default; toggle
  via the `skipDirtyConfirm` setting.

## Export

Export is desktop-only and runs Pandoc from the Rust backend:

- **PDF** &mdash; runs the LaTeX export pipeline and compiles with `latexmk`.
- **LaTeX** &mdash; emits a `.tex` file using `src/latex/template/<variant>.tex`
  (`article` or `lipics`).
- **HTML** &mdash; calls Pandoc directly.

The output path replaces `.md` with the format extension next to the source
file. Batch export is available for an entire project tree from the file
menu; results are reported per-file.

Pandoc and (for PDF) `latexmk` must be installed. Coflat checks dependencies
and reports the missing tool with an install hint before starting an export.
LaTeX template selection, math macro injection, and bib routing are
documented in [FORMAT.md &sect; LaTeX Export](../FORMAT.md#latex-export).

## Editor mode switching

Coflat has two editor modes (Lexical was removed):

- **CM6 rich** &mdash; the default. Edits the markdown source directly with
  Typora-style rich rendering: math, theorem blocks, tables, references, and
  inline formatting are rendered live, but the underlying buffer stays
  markdown.
- **Source** &mdash; raw markdown with no rich widgets. Use this when a
  rendering glitch hides syntax you need to edit, when working with grid
  tables, or when round-tripping foreign markdown.

Switch modes from the editor header. Mode switches preserve content and
cursor position. See [editor-surfaces.md](./editor-surfaces.md) for the
behavior contract.

## Known limits

These are intentional and not bugs:

- No raw inline HTML, HTML comments, reference-style links, bare-URL
  autolink, `>` blockquotes, indented code blocks, or Pandoc definition
  lists. See [FORMAT.md &sect; Removed Features](../FORMAT.md#removed-features)
  for alternatives.
- Browser mode cannot export. Use the Tauri desktop app.
- Grid tables are preserved verbatim but not editable as semantic tables.
- Same-colon nested fenced divs do not parse; outer must use more colons.
- Equation labels must be unique; duplicates resolve as ambiguous in the
  semantic index.
- Citations and cross-references are not parser tokens; they appear as text
  in the syntax tree and are resolved by a downstream semantic pass. They
  render as `[@id]` until the index has loaded the bibliography.

## Troubleshooting

- **Math does not render** &mdash; check the KaTeX error in place; usually a
  missing macro or unsupported command. Define macros in frontmatter
  `math:`. Confirm the document is not inside a fenced code block.
- **Citation shows as `[@key]`** &mdash; bibliography is missing or the key
  is not in the `.bib` file. Check `bibliography:` in frontmatter and the
  diagnostics sidebar.
- **Cross-reference shows as `[@id]`** &mdash; no block, heading, or
  equation with that id was found. Verify the `#id` is on the target.
- **Fenced div not rendering** &mdash; check for a missing closing `:::`,
  same-colon nesting, or a typo in the class name. Source mode is the
  fastest way to confirm.
- **External change banner appears unexpectedly** &mdash; another tool
  (formatter, git checkout) edited the file. Pick *reload*, *keep local*,
  or *merge*.
- **Inspect editor state** &mdash; in the browser console use
  `__editor` and `__app` for surface-neutral helpers, or `__cmDebug` for
  CM6-specific tree, render, and geometry inspection. The full helper list
  is in AGENTS.md &sect; Debug helpers.
