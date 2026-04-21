# Plugin Render Contract

The block plugin contract is split from the CM6 render adapter so plugin
metadata can drive rich rendering without making `src/plugins/` depend on
`src/render/`.

## Ownership

- `src/plugins/` owns block plugin types, registry behavior, and plugin-owned
  render hooks.
- `src/render/plugin-adapters/` owns CM6 widgets, DOM rendering, and decoration
  placement helpers for the CM6 rich surface.
- `src/render/plugin-render.ts` is the generic dispatcher. It may consume the
  plugin registry and render adapters, but it must not branch on individual
  plugin names or plugin-specific string literals such as `"embed"`.

Import direction is one-way:

```text
src/render/plugin-render.ts -> src/plugins/*
src/render/plugin-adapters/* -> src/plugins/plugin-render-adapter
src/plugins/* must not import src/render/*
```

`pnpm lint` runs `scripts/check-plugin-render-boundary.mjs`, which fails when
any module under `src/plugins/` imports, exports from, or dynamically imports
`src/render/`.

## Contract Surface

Plugins expose render intent through `BlockPlugin`:

- `render(attrs)` returns a `BlockDecorationSpec` with the block class and
  header text.
- `displayHeader`, `captionPosition`, and `headerPosition` describe generic
  chrome placement policy.
- `renderDecorations` registers optional plugin-owned decoration hooks, such as
  body-line decorations. The generic renderer calls these hooks without knowing
  which plugin registered them.

Render adapters implement `PluginRenderAdapter` from
`src/plugins/plugin-render-adapter.ts`. The adapter creates widgets for block
headers, captions, and attribute-only titles. The plugin-owned helper functions
in that module only know about source ranges and CodeMirror decoration
lifecycle; concrete widgets stay in `src/render/plugin-adapters/`.

## Adding Plugin Render Behavior

To add plugin-specific rich-mode behavior:

1. Add metadata or `renderDecorations` hooks to the plugin registration.
2. Put CM6 widget or DOM details in `src/render/plugin-adapters/`.
3. Keep generic dispatch in `src/render/plugin-render.ts` based on contract
   fields and hooks, not plugin names.
4. Add focused tests at the contract boundary: plugin registration tests for
   metadata, adapter tests for widgets, and renderer tests for hook dispatch.

Do not add `if (plugin.name === "...")`, `specialBehavior === "embed"`, or
new `src/plugins/` imports from `src/render/`.
