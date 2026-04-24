# Coflat Merge Status

The separate Coflat 2 repository has been archived. This repository is now the
source of truth for one Coflat app with runtime editor switching:

- CM6 rich markdown-native editor.
- Lexical WYSIWYG editor.
- CM6 source editor.

All editor surfaces share `FORMAT.md`, the app shell, file/session IO, semantic
services, markdown diagnostics, project helpers, and Tauri backend code. Editor
selection happens through the app mode (`cm6-rich`, `lexical`, or `source`).

## Completed

- Replaced the product split with one Coflat app identity.
- Removed separate build and Tauri commands for product variants.
- Routed CM6 and Lexical through the shared app shell as runtime editor modes.
- Ported the Lexical editor into `src/lexical`.
- Kept CM6 and Lexical internals isolated behind the app-facing editor surface.
- Removed non-canonical include and provider-specific embed behavior from the
  canonical format path.
- Verified `FORMAT.md` with Pandoc.
- Verified `build:coflat`.
- Verified Lexical heavy-document typing with real browser input, save/reopen,
  and source-mode serialization on `fixtures/cogirth/main2.md` and
  `fixtures/rankdecrease/main.md`.
- Restored Lexical debug/status parity in the shared app shell:
  - Lexical debug sidebar, tree view, FPS/perf/debug toggles, command logging,
    focus tracing, selection-always-on controls, and interaction trace.
  - `__app.ready`, `__editor.ready`, and `__cfDebug.ready` bridge promises for
    automation.
  - Product-neutral `__editor` helpers for reading, editing, selecting, and
    formatting through either CM6 or Lexical.
  - Status-bar Settings, FPS, and writing-stat popovers.
- Restored Lexical format-command behavior so palette/native-menu formatting
  applies through Lexical when the WYSIWYG editor is active.
- Added `pnpm test:browser:lexical`, a browser smoke covering Lexical
  mount, formatting, source-mode serialization, heavy typing, save/reopen, and
  debug-bridge health.
- Audited docs and visible demo/about copy for single-editor assumptions:
  docs now describe runtime editor modes, browser-debug guidance prefers the
  surface-neutral `__editor` bridge, demo prose describes the shared format,
  and the About dialog shows the unified Coflat app identity.

## Coflat 2 Parity Audit

`coflat2-local/main` is an ancestor of this repository's `main`, so there are
no unmerged Coflat 2 commits. The remaining work is file/tree parity: deciding
which Coflat 2-only files still fit the merged architecture.

### Ported

- Product-visible editor/debug surfaces:
  - `src/app/components/status-bar-config.tsx`
  - `src/app/components/status-bar-fps.tsx`
  - `src/app/components/status-bar-stats.tsx`
  - `src/app/editor-format-actions.ts`
  - `src/app/format-markdown.ts`
  - `src/debug/debug-bridge-ready.ts`
- Automation surfaces:
  - Product-neutral `__editor` bridge in `useAppDebug`.
  - Test-helper support for Lexical document reads, selections, formatting, and
    readiness promises.
  - Shared browser-regression Lexical smoke in
    `scripts/regression-tests/lexical-smoke.mjs`.

### Already Represented By Current Coflat Code

- Lexical editor core, source/rich mode switching, inline token boundary,
  source-position mapping, structure editing, table/math/reference renderers,
  interaction trace, and tree view live under `src/lexical`.
- App/file/session ownership is represented by current `useAppEditorShell`,
  `useEditorSession`, app contexts, file watcher, Tauri commands, and shared
  filesystem abstractions. Coflat 2's older `editor-session-store`,
  `file-system`, `memory-file-system`, and split preference-context files were
  not reintroduced because the merged repo already has one owner for those
  concepts.
- Search, labels, diagnostics, and markdown parsing are represented by the
  current CM6/semantic-index modules and shared app hooks.

### Intentionally Not Ported

- Include rendering/editor affordances and include resolver files. The merged
  `FORMAT.md` direction removed include/provider-specific behavior from the
  canonical format path.
- Provider-specific embeds such as gist/youtube support. These were removed to
  keep Pandoc Markdown as the boundary format.
- Coflat 2's old wholesale test runner/helper split. The current repo keeps the
  CM6 browser regression lane as `pnpm test:browser` and adds the targeted
  Lexical smoke as `pnpm test:browser:lexical` to avoid making default CM6
  runs execute Lexical-only assertions.
- Large architecture notes that only describe the abandoned standalone Coflat 2
  rewrite path. The merged architecture is tracked here instead.

### Still Worth Reconsidering Later

- Public-heavy fixture generation and serving scripts. These are useful if we
  need a fully public replacement for private heavy documents in CI.
- Tauri-specific Lexical smoke coverage. Browser smoke now exists; desktop
  packaging still needs a final manual or scripted Tauri lane before release.

## Remaining Cleanup

- Run a final Tauri desktop smoke that switches into Lexical mode before distributing builds.
