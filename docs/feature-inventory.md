# Coflat Feature Inventory

This document is the rebuild-oriented product spec for Coflat as it exists
today. It answers a simple question:

What does a replacement implementation need to do before it can honestly claim
to be "Coflat"?

Use this alongside:

- [DESIGN.md](/Users/chaoxu/playground/coflat/DESIGN.md) for philosophy and constraints
- [FORMAT.md](/Users/chaoxu/playground/coflat/FORMAT.md) for canonical document syntax
- [demo/index.md](/Users/chaoxu/playground/coflat/demo/index.md) for the public showcase surface

This file is a feature inventory, not a low-level architecture document. It
describes the user-visible behavior and the major developer-facing surfaces
that a rebuild must preserve.

## 1. Product Shape

Coflat is a semantic markdown editor for mathematical writing.

The defining product qualities are:

- Plain-text source of truth. Documents stay as markdown files on disk.
- Typora-style editing. Rich rendering is the default; source is revealed only
  where the user is actively editing.
- Semantics-first authoring. The editor understands equations, theorem-like
  blocks, citations, cross-references, figures, tables, includes, and
  frontmatter as structured document concepts.
- Mathematical writing as the primary target. The feature mix is optimized for
  papers, notes, books, and lecture-style documents rather than generic note
  taking.

## 2. Runtime Modes

Coflat runs in two main environments:

- Browser dev mode via Vite, with the demo project loaded by default.
- Desktop app mode via Tauri, with real filesystem/project access.

The editor itself currently exposes these document modes:

- `rich`: the primary mode and the main focus of the product
- `source`: raw markdown editing
- `read`: exists in code, but is intentionally de-emphasized and not the main
  product surface right now

A rebuild must preserve the fact that `rich` mode is the center of gravity.

## 3. Canonical Document Model

The canonical document format is Pandoc-flavored markdown with Coflat-specific
editor support.

### 3.1 Frontmatter

YAML frontmatter is supported and drives document behavior:

- document title
- bibliography path
- CSL path
- numbering scheme
- math macro definitions
- custom block definitions and overrides
- default image folder

File frontmatter overrides project-level config from `coflat.yaml`.

### 3.2 Headings

The editor supports:

- ATX headings `#` through `######`
- automatic numbering
- unnumbered headings via `{-}` or `{.unnumbered}`
- explicit heading IDs via Pandoc attributes
- heading-aware outline and breadcrumbs

### 3.3 Inline markdown

The inline surface supports:

- bold
- italic
- strikethrough
- highlight
- inline monospace/code
- links
- inline images as markdown syntax
- inline math in both `$...$` and `\(...\)` forms

Inline rendering policy varies by surface:

- full-fidelity document surfaces
- document-inline surfaces like rich titles/headings
- degraded chrome-only surfaces like outline/breadcrumbs

That surface distinction is part of the product, not just an implementation
detail.

### 3.4 Display math

Display math is a first-class feature, not a styled text trick.

Supported forms:

- `$$ ... $$`
- `\[ ... \]`
- labeled equations with `{#eq:...}`

Expected behavior:

- rendered with KaTeX in rich mode
- editable as source when explicitly entered
- referenceable like numbered equations
- valid inside ordinary document flow, lists, and semantic blocks

### 3.5 Tables

Pipe tables are supported as structured content.

Expected behavior:

- render as formatted tables in rich mode
- support inline rich content inside cells
- permit direct cell editing
- participate in references and captions when wrapped in `::: {.table}`

### 3.6 Task lists

Task-list syntax is supported:

- `- [ ]`
- `- [x]`

### 3.7 Footnotes

Footnotes are supported as semantic markdown features, including:

- footnote references
- footnote definitions
- footnote-aware rendering and navigation

### 3.8 Includes

Includes are first-class document features.

Expected behavior:

- include blocks via `::: {.include}`
- merged semantic view when a parent document is opened
- numbering and references continue across included files
- include-aware indexing/search behavior

## 4. Semantic Block System

This is one of Coflat's defining features.

The editor treats fenced divs as semantic blocks with plugin-defined behavior.

### 4.1 Block syntax

Supported block capabilities include:

- Pandoc fenced divs with classes, IDs, titles, and key-value attrs
- nesting with increasing colon counts
- inline markdown in titles
- short-form block declaration
- self-closing single-line blocks

### 4.2 Built-in block families

The shipped block types are:

- theorem
- lemma
- corollary
- proposition
- conjecture
- definition
- problem
- proof
- remark
- example
- algorithm
- figure
- table
- blockquote
- embed
- iframe
- youtube
- gist
- include

### 4.3 Block semantics

Blocks are not just styled containers. They carry behavior:

- numbering and shared counter groups
- title handling
- body-style differences such as theorem italics
- special proof behavior including QED handling
- special figure/table caption placement below content
- special blockquote rendering without a visible label
- special embed rendering for iframe-like content

### 4.4 Custom block definitions

Users can define or override block types in frontmatter:

- enable/disable built-in block types
- override block labels/titles
- change numbering on/off
- change or share counter groups

Any rebuild that hardcodes only the default block list is incomplete.

## 5. Rich Editing Model

The rebuild must preserve the editing model, not just the syntax support.

### 5.1 Rich mode behavior

Rich mode means:

- markdown source stays authoritative
- rendered output is shown by default
- source is revealed only where the user is editing
- cursor movement, click mapping, and selection behavior respect the rendered
  surface rather than acting like a plain textarea

### 5.2 Structure editing

Certain block-level and shell-like constructs support explicit structure edit
targets rather than naive text exposure.

Current structure-aware areas include at least:

- frontmatter
- fenced div openers
- code fences
- footnote labels
- display math

### 5.3 Source-to-render mapping

The editor must map between source positions and rendered surfaces for:

- clicking rendered math
- clicking block headers/titles
- clicking code blocks
- search highlights
- hover previews
- keyboard movement into hidden rendered regions

This mapping is core product behavior.

## 6. References, Citations, and Numbering

Coflat treats references as semantic objects, not plain text matches.

### 6.1 Cross-references

Supported patterns include:

- bracketed references `[@id]`
- narrative references `@id`
- clustered references
- equation references
- block references by ID

Rendered results depend on the referenced thing:

- theorem-like blocks resolve to block labels/numbers
- equations resolve to equation numbers
- figures/tables resolve to their numbered captions

### 6.2 Citations

Bibliography-backed citations are supported through `.bib` + CSL data.

Expected behavior:

- citation resolution from bibliography files
- rich rendering of citations in the document
- distinction between citations and block/equation cross-references
- bibliography-aware search and formatting paths

### 6.3 Numbering

Numbering is document-wide and semantics-aware.

Features include:

- heading numbering
- theorem-family shared counters
- separate definition/algorithm/figure/table counters
- equation numbering
- numbering continuity across includes
- grouped vs global numbering control from frontmatter

## 7. Media, Embeds, and Figures

### 7.1 Images and figures

The editor supports:

- markdown images
- figure blocks with captions below media
- local media resolution
- local PDF image preview rendering
- image-folder defaults from config

The local PDF preview path is a real product feature, not just a test hook.

### 7.2 Embeds

The embed family includes:

- generic embed iframe blocks
- explicit iframe blocks
- YouTube blocks
- GitHub Gist blocks

Expected behavior:

- embed URL normalization/safety checks
- rendered iframe-like rich previews
- stable rich-mode behavior without falling back to raw block syntax unless
  explicitly editing

## 8. Code Blocks

Code fences are a first-class rich surface.

Expected behavior:

- fenced code blocks only; no indented code blocks
- language label in rich mode
- copy button in code block header
- click mapping that lands on the correct source line
- structure-aware editing of the opening fence when needed

## 9. Search, Navigation, and Chrome

The app shell is part of the product surface.

### 9.1 File and project navigation

Expected app-level capabilities:

- open file
- open folder/project
- sidebar file tree
- tabs
- dirty indicators
- recent files
- window/project state persistence

### 9.2 Document navigation

Expected document-navigation capabilities:

- outline sidebar
- breadcrumbs
- go to line
- cross-reference navigation
- semantic navigation in rich mode

### 9.3 Search

There are two distinct search surfaces:

- command palette / command search
- document/project search panel

The search panel supports mode-aware behavior:

- semantic search in rich/semantic contexts
- raw source-oriented search in source contexts

### 9.4 Status and settings surfaces

The app includes:

- status bar
- mode button / mode switching
- shortcuts dialog
- settings dialog
- diagnostics/runtime log surfaces

## 10. Desktop App Features

The Tauri build is not just a wrapper around the browser demo.

Important native-facing behavior includes:

- real filesystem-backed projects
- native Open File / Open Folder / Save As flows
- native menu integration
- keyboard shortcut wiring
- unsaved-changes close/quit flow
- file watching for external changes
- multi-window/session-aware state

## 11. Debug, Inspection, and Regression Surfaces

These are rebuild requirements too, because they are how Coflat is debugged and
kept stable.

### 11.1 In-browser debug bridge

The dev build exposes runtime globals such as:

- `__cmView`
- `__cmDebug`
- `__app`
- `__cfDebug`
- `__tauriSmoke` in Tauri dev mode

These are used for:

- state inspection
- deterministic file opening
- structure activation
- geometry and selection snapshots
- performance and scroll-guard telemetry

### 11.2 Debug timeline and session recorder

The dev app records debug session events for:

- key events
- pointer events
- scroll events
- caret/range changes
- document changes
- focus changes
- structure changes
- motion-guard events

The Vite dev server sinks these events to `/tmp/coflat-debug`.

### 11.3 Browser regression harness

The repo includes managed browser regressions for feature behavior. A rebuild
must preserve this testability.

Important covered areas already include:

- rich-mode scroll stability
- block widget keyboard access
- local PDF preview rendering
- fenced div behavior
- tables
- footnotes
- cross-references
- headings
- code blocks

## 12. Public Acceptance Surface

If someone is rebuilding Coflat, the public minimum acceptance pass should at
least include:

- [demo/index.md](/Users/chaoxu/playground/coflat/demo/index.md) renders correctly in rich mode
- the syntax in [FORMAT.md](/Users/chaoxu/playground/coflat/FORMAT.md) is accepted and behaves as documented
- the browser regression harness passes on the public showcase
- the editor still feels like Typora-style source-backed editing rather than a
  separate rich-text editor

## 13. What Is Explicitly Not the Core Product

These are currently outside the core definition of Coflat:

- generic PKM features like graph view or daily notes
- computation notebook behavior
- LaTeX-grade typesetting control inside the editor itself
- replacing Pandoc as the export toolchain

## 14. Rebuild Checklist

A serious rebuild should be able to answer "yes" to all of these:

- Can it open plain markdown files and keep them as the source of truth?
- Does it support Coflat's document format, not just generic markdown?
- Does rich mode preserve source-backed Typora-style editing?
- Are semantic blocks plugin-driven rather than hardcoded one-offs?
- Do equations, figures, tables, citations, and cross-references behave like
  semantic objects?
- Do numbering and includes work at the document level?
- Does the app shell include project/file/navigation/search surfaces?
- Does the dev build expose enough runtime/debug tooling to trace regressions?
- Can the public showcase and browser regressions be used as acceptance tests?

If the answer to any of those is "no", the rebuild is missing part of Coflat's
current feature surface.
