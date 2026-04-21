# Getting Started

## Quick start

```bash
pnpm install
pnpm dev              # Coflat browser mode with demo content at localhost:5173
pnpm dev:coflat2     # Coflat 2 browser mode with the Lexical editor
pnpm tauri:dev        # Coflat desktop app (requires Rust toolchain)
pnpm tauri:dev:coflat2 # Coflat 2 desktop app
```

## Reading order

1. **[DESIGN.md](../DESIGN.md)** — what Coflats are, the editing models, and core concepts
2. **[AGENTS.md](../AGENTS.md)** — commands, project structure, conventions, and tooling reference
3. **[FORMAT.md](../FORMAT.md)** — the Pandoc-flavored markdown format the editors understand
4. **[Feature inventory](feature-inventory.md)** — rebuild-oriented checklist of the full current product surface

## Architecture docs

Read these when you're working on a specific area:

- **[Architecture decisions](architecture/architecture-decisions.md)** — why Pandoc-free, why Lezer, the plugin system, FileSystem abstraction
- **[Development rules](architecture/development-rules.md)** — rigor mode, dual-editor ownership, CM6 decoration rules, Lezer parser invariants, testing gates
- **[Subsystem pattern](architecture/subsystem-pattern.md)** — model/controller/render-adapter seam pattern for non-trivial features
- **[Theme contract](architecture/theme-contract.md)** — CSS variable tokens, surface map, appearance mode
- **[Inline rendering policy](design/inline-rendering-policy.md)** — how inline math, bold, italic rendering works

## Key concepts

- **Two products share one shell.** Coflat uses the CM6 markdown-native editor. Coflat 2 uses the Lexical WYSIWYG editor. Product selection happens through `VITE_COFLAT_PRODUCT`.
- **Markdown is the boundary format.** Coflat edits markdown directly. Coflat 2 edits a rich document model and serializes to Pandoc-flavored markdown at load/save boundaries.
- **Lezer** is the shared markdown structure parser for Coflat's editor surface and shared semantic/export paths. Custom markdown extensions live in `src/parser/`.
- **Rich mode depends on the product.** Coflat rich mode is Typora-style source-backed rendering. Coflat 2 rich mode is WYSIWYG editing with markdown serialization.
- **Block plugins** (`src/plugins/`) define theorem/proof/definition environments as fenced divs. Each block type has a manifest entry, counter group, and render function.

## Development workflow

```bash
pnpm dev:show        # stable no-HMR dev server for shared review on localhost:5173
pnpm test:watch      # run tests in watch mode
pnpm test:focused -- src/render/reference-render.test.ts
                     # automation-safe single-worker render/state verification
pnpm typecheck       # repo-wide baseline typecheck
pnpm lint:fix        # auto-fix lint issues
```

Pre-commit hooks run `biome lint` on staged files. Pre-push hooks run `typecheck` and `test`.

## Browser testing

```bash
pnpm dev                  # terminal 1, Coflat
pnpm test:browser         # terminal 2, stable CM6 regression lane

pnpm dev:coflat2          # terminal 1, Coflat 2
pnpm test:browser:coflat2 # terminal 2, Lexical smoke lane
```

For manual visual debugging, use the CDP/app-mode lane instead:

```bash
pnpm dev                  # or pnpm dev:coflat2
pnpm chrome          # launches Chromium with CDP on port 9322
```

Use `window.__editor` and `window.__app` in the browser console for product-neutral editor state introspection. Use `window.__cmDebug` only for Coflat CM6-specific parser/render/geometry debugging. See the debug helpers section in AGENTS.md for the full API.

For the supported focused-test and heavy-doc perf commands, see [verification-workflows.md](./verification-workflows.md).
