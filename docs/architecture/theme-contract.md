# Theme Contract

Coflat's theme system has four layers: appearance mode, token contract, surface map, and theme sources.

## Appearance mode

Three modes: `light`, `dark`, `system`. `ResolvedTheme` is always `"light" | "dark"` — `"system"` resolves via `matchMedia("(prefers-color-scheme: dark)")`.

- State ownership: settings
- DOM application: `src/app/theme-dom.ts` sets `data-theme` on `document.documentElement`
- Writing theme variables: applied as inline CSS custom properties on root
- Custom CSS: injected via `<style id="cf-custom-css">` in `<head>`

## Token contract

Canonical token names live in `src/theme-contract.ts`. All tokens are CSS custom properties prefixed `--cf-`.

### Foundation (21 tokens)

`--cf-bg`, `--cf-bg-secondary`, `--cf-fg`, `--cf-muted`, `--cf-border`, `--cf-subtle`, `--cf-hover`, `--cf-active`, `--cf-accent`, `--cf-accent-fg`, `--cf-bg-overlay`, `--cf-border-overlay`, `--cf-border-radius`, `--cf-border-radius-lg`, `--cf-spacing-xs`, `--cf-spacing-sm`, `--cf-spacing-md`, `--cf-spacing-lg`, `--cf-border-width`, `--cf-border-width-accent`, `--cf-transition`

### Layer (3 tokens)

`--cf-layer-inline-chrome`, `--cf-layer-preview-surface`, `--cf-layer-block-picker`

### Block (37 tokens)

Header/title: `--cf-block-header-accent`, `--cf-block-header-border-width`, `--cf-block-title-color`, `--cf-block-title-weight`, `--cf-block-title-display`, `--cf-block-title-separator`, `--cf-block-margin`

Per-type pairs (`-accent` and `-style`): theorem, lemma, corollary, proposition, conjecture, definition, problem, example, remark, proof, algorithm, figure, table

Nesting: `--cf-block-nest-1` through `--cf-block-nest-4`

Proof: `--cf-proof-marker`, `--cf-proof-marker-color`, `--cf-proof-marker-size`

### Table and misc (11 tokens)

`--cf-blockquote-border`, `--cf-blockquote-color`, `--cf-table-border`, `--cf-table-header-border`, `--cf-table-cell-padding`, `--cf-table-font-size`, `--cf-table-line-height`, `--cf-table-edit-outline`, `--cf-mark-bg`, `--cf-math-error-fg`, `--cf-math-error-bg`

### Typography (27 tokens)

Fonts: `--cf-ui-font`, `--cf-content-font`, `--cf-code-font`, `--cf-base-font-size`, `--cf-line-height`, `--cf-content-max-width`, `--cf-sidenote-width`, `--cf-fence-guide-width`, `--cf-ui-font-size-sm`, `--cf-ui-font-size-base`

Headings h1–h6: each has `-size`, `-weight`, `-style` (18 tokens total)

### Preview (5 tokens)

`--cf-preview-surface-max-width`, `--cf-preview-surface-max-height`, `--cf-preview-surface-padding-block`, `--cf-preview-surface-padding-inline`, `--cf-preview-surface-font-size`

## Surface map

`themeSurfaceTokenMap` in `src/theme-contract.ts` controls which tokens are exposed to each surface:

| Surface | What it covers | Key tokens |
|---|---|---|
| `appChrome` | Sidebar, toolbar, file tree | Foundation colors, UI font/size, spacing, layer tokens |
| `editorBody` | Rich/source editing area | `--cf-bg/fg`, content+code fonts, font-size, line-height, content-max-width, sidenote-width, fence-guide-width |
| `readMode` | Read-only view | Same as editorBody minus sidenote-width and fence-guide-width |
| `blockSurfaces` | Theorem/proof/definition blocks | `--cf-fg`, all block/title tokens, per-type accents, nest 1-4, proof marker |
| `tables` | Tables | `--cf-border`, all table tokens, code-font |
| `tooltipAndHover` | Hover previews, crossref tooltips | `--cf-bg-overlay`, border-overlay, fg/muted/border, all preview tokens |

## Theme sources

Theme sources are distinct from application:

- **Writing themes** — built-in presets (e.g. serif, monospace) that set typography and color tokens
- **Typography presets** — font family and size overrides
- **Custom CSS** — user-provided CSS injected at runtime

`useTheme` orchestrates these sources. Token ownership stays in `src/theme-contract.ts`; DOM mutation stays in `src/app/theme-dom.ts`.
