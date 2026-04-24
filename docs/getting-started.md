# Getting Started

## Quick start

```bash
pnpm install
pnpm dev              # Coflats browser mode with demo content at localhost:5173
pnpm tauri:dev        # Coflats desktop app (requires Rust toolchain)
```

## Reading order

1. **[DESIGN.md](../DESIGN.md)** — what Coflats are, the editing models, and core concepts
2. **[AGENTS.md](../AGENTS.md)** — commands, project structure, conventions, and tooling reference
3. **[FORMAT.md](../FORMAT.md)** — the Pandoc-flavored markdown format the editors understand
4. **[Feature inventory](feature-inventory.md)** — rebuild-oriented checklist of the full current product surface
5. **[Devx workflow](devx-workflow.md)** — issue wrapper, merge-task helper, and verification record conventions

## Architecture docs

Read these when you're working on a specific area:

- **[Architecture decisions](architecture/architecture-decisions.md)** — why Pandoc-free, why Lezer, the plugin system, FileSystem abstraction
- **[Development rules](architecture/development-rules.md)** — rigor mode, dual-editor ownership, CM6 decoration rules, Lezer parser invariants, testing gates
- **[Subsystem pattern](architecture/subsystem-pattern.md)** — model/controller/render-adapter seam pattern for non-trivial features
- **[Theme contract](architecture/theme-contract.md)** — CSS variable tokens, surface map, appearance mode
- **[Inline rendering policy](design/inline-rendering-policy.md)** — how inline math, bold, italic rendering works

## Key concepts

- **One app switches editor surfaces.** Coflats can switch at runtime between CM6 rich mode, Lexical WYSIWYG mode, and CM6 source mode.
- **Markdown is the boundary format for Lexical.** CM6 edits markdown directly. Lexical edits a rich document model and serializes to Pandoc-flavored markdown at load/save boundaries.
- **Lezer** is the shared markdown structure parser for Coflat's editor surface and shared semantic paths. Pandoc owns document export. Custom markdown extensions live in `src/parser/`.
- **Rich modes are explicit.** CM6 rich mode is Typora-style source-backed rendering. Lexical mode is WYSIWYG editing with markdown serialization.
- **Block plugins** (`src/plugins/`) define theorem/proof/definition environments as fenced divs. Each block type has a manifest entry, counter group, and render function.

## Development workflow

```bash
pnpm dev:show        # stable no-HMR dev server for shared review on localhost:5173
pnpm test:watch      # run tests in watch mode
pnpm test:focused -- src/render/reference-render.test.ts
                     # automation-safe single-worker render/state verification
pnpm check:pre-push  # fast local gate used by lefthook pre-push
pnpm check:merge     # full local merge gate before closing broad issues
pnpm check:static    # lint + typecheck + unused-code/dependency check
pnpm check:types     # root + server typecheck
pnpm issue -- list   # safe local Gitea issue wrapper
pnpm merge-task -- --branch worker-branch
                     # print worker-branch integration commands
pnpm lint:fix        # auto-fix lint issues
```

Pre-commit hooks run `pnpm check:staged-lint` on staged files. Pre-push hooks run `pnpm check:pre-push`; run `pnpm check:merge` before merging or closing broad implementation issues.

## Browser testing

```bash
pnpm dev                  # terminal 1, Coflats
pnpm test:browser         # terminal 2, stable CM6 regression lane

pnpm dev                  # terminal 1, Coflats
pnpm test:browser:lexical # terminal 2, Lexical smoke lane
```

For manual visual debugging, use the CDP/app-mode lane instead:

```bash
pnpm dev
pnpm chrome          # launches Chromium with CDP on port 9322
```

Use `window.__editor` and `window.__app` in the browser console for surface-neutral editor state introspection. Use `window.__cmDebug` only for CM6-specific parser/render/geometry debugging. See the debug helpers section in AGENTS.md for the full API.

For the supported focused-test and heavy-doc perf commands, see [verification-workflows.md](./verification-workflows.md).
