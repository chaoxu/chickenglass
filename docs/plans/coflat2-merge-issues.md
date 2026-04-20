# Coflat 2 Merge Issues

Goal: merge Coflat and Coflat 2 into one repository that builds two products:
Coflat with the CM6 markdown-native editor, and Coflat 2 with the Lexical
WYSIWYG editor.

## Issues

1. Canonical format and export baseline
   - Status: complete in this slice.
   - Keep `FORMAT.md` identical across both repos during migration.
   - Port the `coflat2` LaTeX/export layer into `coflat`.
   - Add focused conformance tests for the Pandoc reader profile.

2. Product identity and build selection
   - Status: complete in this slice.
   - Add product config for `coflat` and `coflat2`.
   - Build separate app/bundle names without using "Flat".

3. Shared editor adapter contract
   - Status: complete in this slice.
   - Define the small app-facing editor interface.
   - Adapt the current CM6 editor to that interface before importing Lexical.

4. Shared app infrastructure convergence
   - Status: merge-ready; follow-up polish remains.
   - Reconcile app shell, settings, session, workspace, file dialogs, debug bridge,
     and status bar differences.
   - Current slice routes both products through the shared app shell, keeps
     session/file IO shared, and verifies Coflat 2 through a real Lexical browser
     edit. Remaining work is UX polish around product-specific status-bar modes
     and deeper debug bridge parity.

5. Shared format services
   - Status: complete in this slice.
   - Move frontmatter, labels, headings, citations, search/index, and path helpers
     into neutral modules consumed by both editors.

6. Lexical editor import
   - Status: complete in this slice.
   - Port `coflat2` Lexical modules behind the editor adapter.
   - Keep CM6 and Lexical internals isolated.

7. Legacy non-canonical features
   - Status: complete in this slice.
   - Removed non-canonical file-projection behavior and provider-specific external
     media rendering from the canonical app path.
   - Non-manifest fenced div classes now fall through as ordinary custom blocks.

8. Verification matrix
   - Status: complete for merge readiness.
   - Add test/build lanes for both products.
   - Add browser smoke checks for both editor engines.
   - Current slice adds package scripts for both products, verifies
     `build:coflats`, and passes a Coflat 2 browser smoke that loads a fixture,
     confirms the Lexical editor engine, types into the WYSIWYG surface, and sees
     dirty state update.
