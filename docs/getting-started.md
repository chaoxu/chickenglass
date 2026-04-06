# Getting Started

## Quick start

```bash
pnpm install
pnpm dev          # browser mode with demo content at localhost:5173
pnpm tauri:dev    # desktop app (requires Rust toolchain)
```

## Reading order

1. **[DESIGN.md](../DESIGN.md)** — what Coflat is, the editing model, and core concepts
2. **[AGENTS.md](../AGENTS.md)** — commands, project structure, conventions, and tooling reference
3. **[FORMAT.md](../FORMAT.md)** — the Pandoc-flavored markdown format the editor understands

## Architecture docs

Read these when you're working on a specific area:

- **[Architecture decisions](architecture/architecture-decisions.md)** — why Pandoc-free, why Lezer, the plugin system, FileSystem abstraction
- **[Development rules](architecture/development-rules.md)** — rigor mode, CM6 decoration rules, Lezer parser invariants, testing gates
- **[Subsystem pattern](architecture/subsystem-pattern.md)** — model/controller/render-adapter seam pattern for non-trivial features
- **[Theme contract](architecture/theme-contract.md)** — CSS variable tokens, surface map, appearance mode
- **[Inline rendering policy](design/inline-rendering-policy.md)** — how inline math, bold, italic rendering works

## Key concepts

- **CodeMirror 6** is the editor engine. State changes go through `view.dispatch()`. Extensions (StateField, ViewPlugin, Facet) compose the editor behavior.
- **Lezer** is the incremental parser. Custom markdown extensions live in `src/parser/`. The syntax tree drives all rendering, indexing, and semantic analysis.
- **Rich mode** is Typora-style: the source markdown is the ground truth, but the editor renders it with widgets and decorations. There is no separate rich text model.
- **Block plugins** (`src/plugins/`) define theorem/proof/definition environments as fenced divs. Each block type has a manifest entry, counter group, and render function.

## Development workflow

```bash
pnpm dev             # start dev server
pnpm test:watch      # run tests in watch mode
pnpm test:changed    # run only tests affected by your changes
pnpm typecheck:watch # incremental type checking
pnpm lint:fix        # auto-fix lint issues
```

Pre-commit hooks run `biome lint` on staged files. Pre-push hooks run `typecheck` and `test`.

## Browser testing

```bash
pnpm dev             # terminal 1
pnpm chrome          # terminal 2 — launches Chromium with CDP on port 9322
```

Use `window.__cmDebug` and `window.__app` in the browser console for editor state introspection. See the debug helpers section in AGENTS.md for the full API.
