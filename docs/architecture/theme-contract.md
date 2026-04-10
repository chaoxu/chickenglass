# Theme Contract

Theme tokens are grouped by responsibility:

- `appChrome`: shell surfaces, dialogs, tabs, sidebar, status bar
- `editorBody`: Lexical/source editing surface
- `exportSurface`: HTML/export consumers
- `blockSurfaces`: theorem/proof/include/table block chrome
- `tables`: table and embed styling
- `tooltipAndHover`: overlays, previews, floating surfaces

The canonical token definitions live in `src/theme-contract.ts`.

Rules:

- Add new tokens only when a value is shared across multiple surfaces.
- Reuse existing `--cf-*` tokens before inventing new ones.
- Keep the standalone editor CSS compatible with the same token set as the app shell.
