# Theme Contract

This document describes Coflat's theme contract in four layers:

1. appearance mode
2. token contract
3. surface map
4. theme sources

## Appearance mode

Appearance mode is only:

- `light`
- `dark`
- `system`

State ownership lives in settings. DOM application belongs in
`src/app/theme-dom.ts`.

## Token contract

The canonical token names live in `src/theme-contract.ts`.

Token families:

- foundation tokens
- block/document tokens
- table/error tokens
- typography tokens
- preview/tooltip tokens

## Surface map

The token-to-surface map is explicit in `themeSurfaceTokenMap`:

- app chrome
- editor body
- read mode
- block surfaces
- tables
- tooltip / hover surfaces
- export

## Theme sources

Theme sources stay distinct from application:

- built-in writing themes
- typography presets
- custom CSS

`useTheme` orchestrates these sources, but token ownership stays in the shared
contract and DOM mutation stays in `theme-dom`.
