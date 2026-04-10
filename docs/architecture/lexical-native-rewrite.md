# Lexical-Native Rewrite

This document defines the target architecture for the editor rewrite.

## Goals

- Keep Markdown I/O identical to the current `FORMAT.md` contract.
- Make Lexical the native interactive document tree, not a thin renderer over
  ad hoc Markdown-shaped UI state.
- Give each semantic concept one code path.
- Make the editor predictable for users and maintainers: no separate inactive
  vs active semantics, no stray floating chrome, no field-specific special-case
  stacks unless the field semantics actually differ.

## Non-goals

- Preserve backward compatibility with the current editor internals.
- Preserve current plugin boundaries when they fight the target ownership
  model.
- Keep parallel renderers alive long term once the new subsystem exists.

## Core invariants

- Markdown remains the canonical persisted format.
- Lexical owns interactive tree state, selection behavior, and DOM behavior.
- The same semantic family must use the same runtime path everywhere.
- Field treatment is driven by field semantics, not by the current component
  shape.
- Floating UI must attach to the actual editor scroll surface.

## Semantic families

Inline text formats are one family:

- bold
- italic
- strikethrough
- highlight
- code

They should share the same Lexical text-format path, with only delimiter and
style differences.

Embedded fields fall into three families:

- inline fields: captions, titles, other one-line semantic text
- rich block fields: table cells, block bodies, footnote bodies
- source-text fields: block openers, include paths, raw metadata

Do not mix these. In particular, do not mount block-level editors inside inline
layout slots.

## Subsystem layout

The rewrite lives under `src/lexical-next/` until it fully replaces the current
editor.

```text
src/lexical-next/
  model/        # field families, shared semantic registries, pure selectors
  controller/   # orchestration, document sync, overlay ownership, commands
  surface/      # React/Lexical wiring for the editor shell
  markdown/     # markdown import/export adapters at the boundary
```

Rules:

- `model/` stays pure.
- `controller/` may coordinate Lexical/editor state but should not own React
  layout.
- `surface/` owns the actual scroll surface, portal roots, and view wiring.
- `markdown/` is the only place that should care about Markdown syntax details
  once the Lexical tree is live.

## Migration strategy

1. Define the new semantic registries and surface ownership contracts.
2. Build the new rich editor shell around an explicit scroll surface owner.
3. Reintroduce semantic families one at a time:
   inline text formats,
   inline math/references,
   block bodies,
   tables,
   captions/titles,
   code blocks,
   overlays.
4. Keep browser parity tests focused on semantic families, not on individual
   bug reproductions only.
5. Replace the current editor once the new shell passes Markdown round-trip,
   browser behavior, and performance checks.
