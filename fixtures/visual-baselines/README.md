# Visual baselines

Structural snapshots (no PNGs) for canonical authoring states. Each `*.json`
file is the expected normalized DOM + anchors + key computed styles for one
canonical state. Generated and verified by
`scripts/regression-tests/visual-baselines.mjs`.

## Verify

```
pnpm test:browser:visual
```

A diff is printed for every path that changed, in the form
`$.snapshot.dom...: <baseline> -> <current>`. Re-run with `--update` to
regenerate the baselines if the rendering change is intentional, then commit
the JSON change.

## Update

```
pnpm test:browser:visual -- --update
```

## Tauri lane

Run `pnpm tauri:dev`, note the URL it serves (typically
`http://127.0.0.1:1420`), then:

```
COFLAT_TAURI_URL=http://127.0.0.1:1420 pnpm test:browser:visual
# or to regenerate the Tauri-specific baselines
COFLAT_TAURI_URL=http://127.0.0.1:1420 pnpm test:browser:visual -- --update
```

Tauri baselines live under `tauri/`. They are kept separate from the browser
baselines because the WKWebView/WebView2 surface can have different default
fonts and computed styles than Chromium, even though the structural DOM tree
should be identical.
