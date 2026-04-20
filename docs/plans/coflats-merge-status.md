# Coflats Merge Status

The separate Coflat 2 repository has been archived. This repository is now the
source of truth for both products:

- Coflat: CM6 markdown-native editor.
- Coflat 2: Lexical WYSIWYG editor.

Both products share `FORMAT.md`, the app shell, file/session IO, semantic
services, markdown diagnostics, project helpers, and Tauri backend code. Product
selection happens through `VITE_COFLAT_PRODUCT`.

## Completed

- Added product configuration for `coflat` and `coflat2`.
- Added build and Tauri commands for both products.
- Routed both products through the shared app shell.
- Ported the Lexical editor into `src/lexical`.
- Kept CM6 and Lexical internals isolated behind the app-facing editor surface.
- Removed non-canonical include and provider-specific embed behavior from the
  canonical format path.
- Verified `FORMAT.md` with Pandoc.
- Verified `build:coflats`.
- Verified Coflat 2 heavy-document typing with real browser input, save/reopen,
  and source-mode serialization on `fixtures/cogirth/main2.md` and
  `fixtures/rankdecrease/main.md`.

## Remaining Cleanup

- Add the heavy Coflat 2 typing smoke as a committed regression script.
- Finish product-specific status-bar and debug-bridge parity polish.
- Audit docs and UI copy for single-editor assumptions.
- Run a final Tauri desktop smoke for Coflat 2 before distributing builds.
