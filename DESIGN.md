# Coflats — Design Document

## What is it

A shared desktop/browser codebase for semantic document editors, optimized for
mathematical writing. It builds Coflat with the CM6 markdown-native editor and
Coflat 2 with the Lexical WYSIWYG editor. Both products share the same document
format, app shell, file IO, semantic services, and Tauri backend.

## Core philosophy

- Semantics first, presentation derived.
- Coflat edits Pandoc-flavored markdown directly; Coflat 2 edits a rich document
  model and uses markdown as the boundary serialization format.
- Every block type is a plugin. The core knows nothing about "theorem" or "proof."
- Pandoc-free editing loop. Pandoc is an export tool, not part of the core.
- Git-friendly: plain text files, meaningful diffs.

## Stack

- **Language**: TypeScript (frontend) + Rust (Tauri backend)
- **Editors**: CodeMirror 6 for Coflat; Lexical for Coflat 2
- **Parser**: Lezer (extending `@lezer/markdown`)
- **Math**: KaTeX
- **Desktop**: Tauri v2 (~5MB binary, native OS webview)
- **Build**: Vite (frontend), Cargo (backend)
- **Future CRDT**: Yjs (text-level for v2, AST-level for v3)

## Document format

Pandoc-flavored markdown with these modifications:

- **No indented code blocks.** Fenced code blocks (```) only. Tab/4-space indentation is purely cosmetic.
- **Math**: Both `$...$` / `$$...$$` and `\(\)` / `\[\]` supported. User chooses.
- **Equation labels**: Pandoc-crossref style: `$$ Ax = b $$ {#eq:foo}`
- **Semantic blocks**: Pandoc fenced divs.
- **References**: `[@id]` for parenthetical, `@id` for narrative. Same syntax for both cross-references and citations. The editor resolves which is which by checking if the id matches a block label or a bib entry.
- **Nesting**: More colons on outer fences.
- **Prefer fenced divs over line-prefix syntax for multi-line blocks.** Line-prefix syntax (like `>` for blockquotes) requires a marker on every line, breaks with text reflow, and is a visual convention rather than a semantic one. Fenced divs have clear start/end boundaries, no per-line markers, and named semantics. `>` is still parsed for compatibility when importing existing markdown, but the canonical Coflat way is `::: Quote`. This extends to any block-level construct: `::: Note`, `::: Warning`, `::: Aside`, etc. — all are just plugins.

### Semantic blocks

```markdown
::: {.theorem #label} Optional Title with $math$
Content here, parsed as full markdown.
:::

::: {.proof}
Content here. ∎
:::
```

Blocks are fenced divs with a class (`.theorem`) and optional id (`#label`) and title (text after `}`).

Nesting uses more colons:

```markdown
:::::: {.theorem #big}
Setup.

::: {.proof}
Proof. ∎
:::
::::::
```

### Block plugin system

The core editor only understands "fenced div with attributes." Plugins register:

- **Class name** they handle (e.g., `theorem`, `proof`, `algorithm`)
- **Parser** for the block body (most reuse the markdown parser; an algorithm plugin could use a pseudocode parser)
- **Renderer** (how to display in the editor)
- **Numbering** (counter group, whether to auto-number)
- **Defaults** (QED symbol, styling, etc.)

A default plugin pack ships with common math environments:

```
theorem, lemma, corollary, proposition, conjecture,
definition, proof, remark, example, algorithm
```

Numbering defaults:
- theorem, lemma, corollary, proposition, conjecture share one counter
- definition has its own counter
- proof, remark, example are unnumbered

Users enable plugins and can override defaults in frontmatter:

```yaml
---
blocks:
  theorem: true
  lemma: true
  proof: true
  # custom block
  claim:
    counter: theorem  # shares counter with theorem
    numbered: true
---
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri Window (WebView)                      │
│  ┌─────────────────────────────────────────┐ │
│  │            Editor (CM6)                 │ │
│  │                                         │ │
│  │  Markdown text ←→ Lezer parser → AST    │ │
│  │       ↑                          ↓      │ │
│  │       │                  CM6 Decorations │ │
│  │       │                          ↓      │ │
│  │  Source on focus ←──→ Rendered otherwise │ │
│  │                        (KaTeX, blocks)  │ │
│  └──────────────┬──────────────────────────┘ │
│                 │ invoke()                    │
│  ┌──────────────▼──────────────────────────┐ │
│  │  Rust Backend                           │ │
│  │  - fs commands (read/write/list/create) │ │
│  │  - open_folder dialog                   │ │
│  │  - path security (no traversal)         │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
           ↓ save                ↑ load
     .md files on disk (git-tracked)
           ↓ export (optional)
        Pandoc → PDF, LaTeX, DOCX
```

### AST nodes

Every AST node tracks its source position (Lezer does this by default). This enables:

- Precise source ↔ rendered mapping for Typora-style editing
- Structural edits in v3 that patch only affected source regions
- Semantic indexing for search

### Parser

Extends `@lezer/markdown` with:

1. **Remove**: `IndentedCode` block parser
2. **Add**: `\(\)` and `\[\]` math syntax (InlineParser + BlockParser)
3. **Add**: Fenced div parser as composite blocks (content parsed as markdown)
4. **Add**: Equation label parser (`{#eq:foo}` after `$$`)
5. **Add**: Cross-reference resolver (distinguish `[@id]` as block ref vs citation)

Block plugins register additional Lezer extensions for custom body parsers.

### Rendering (CM6 ViewPlugins)

- **Math**: KaTeX renders `$...$` and `$$...$$` inline. Source reveals on cursor focus.
- **Semantic blocks**: Rendered with type label, number, optional title. Source (`::: {.theorem ...}`) reveals on cursor focus at the fence lines.
- **Cross-references**: Rendered as "Theorem 1" / "Eq. (3)" etc. Source `[@thm-label]` reveals on focus.
- **Citations**: Rendered as "(Karger, 2000)" or "Karger (2000)". Source `[@karger2000]` reveals on focus. Bibliography loaded from `.bib` file specified in frontmatter.

### Indexer

A background process (or web worker) that:

- Parses all `.md` files in the project
- Builds an index of all labeled blocks, equations, citations
- Resolves cross-references across files
- Enables semantic search: "find all theorems," "find all blocks referencing $\lambda(M)$"
- Updates incrementally on file change

## Versioning roadmap

### v2 (this version)

- CodeMirror 6 editor with Lezer markdown parser extensions
- Typora-style rendering (source on focus)
- Block plugin system with default math environments
- KaTeX math rendering
- Cross-references and citations
- File inclusion with continuous numbering
- Semantic search/indexing
- Desktop app via Tauri v2 (replaced Electron)
- Git integration: none (use externally)
- Export: Pandoc CLI (manual)

### v3 (future)

- Full structural editing (AST as source of truth, bidirectional)
- Real-time collaboration via Yjs (text-level CRDT initially, AST-level later)
- Integrated export pipeline
- Git-aware UI (optional)

## Non-goals

- Not a general-purpose note-taking app (no daily notes, no graph view)
- Not a LaTeX replacement (no fine-grained typographic control)
- Not a computation notebook (no code execution)
- Graph view: computable from the index, but not a core UI feature
