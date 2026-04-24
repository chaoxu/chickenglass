# Standalone Editor API

`coflat/editor` exposes the editor core without the Coflat app shell.

## Install

```bash
npm install coflat
```

## Dependency Boundary

The standalone editor package intentionally exposes only the editor runtime.
App-shell packages such as Tauri, Radix dialogs/selects, drag-and-drop tabs,
file-tree widgets, websocket helpers, and Zustand stores are not part of the
`coflat/editor` contract.

Editor build dependencies are owned by `scripts/editor-package-manifest.mjs`.
Change that manifest when a package becomes part of the public editor runtime or
when a package is intentionally bundled into the editor artifact; do not rely on
the root `dependencies` list as the editor contract. `pnpm check:package` builds
the editor bundle and runs the package smoke test. The build fails on bare
package imports outside the manifest, and the smoke test fails if generated
`dist/editor.mjs` exposes an external dependency outside the public runtime list
or imports an app-only dependency.

## Quick Start

```js
import "coflat/editor/style.css";
import { mountEditor } from "coflat/editor";

const editor = mountEditor({
  parent: document.getElementById("editor"),
  doc: "# Hello\n\nEdit me.",
  mode: "rich",
});

// Read back the document
console.log(editor.getDoc());

// Switch to source mode
editor.setMode("source");

// Tear down when done
editor.unmount();
```

For local manual testing, create a small host page around the Quick Start snippet
above. The repo does not commit a public standalone fixture page.

## Import

```ts
import "coflat/editor/style.css";
import { mountEditor } from "coflat/editor";
```

The CSS import is required. It provides:

- KaTeX font-face definitions and packaged fonts under `dist/fonts`
- `--cf-*` design token defaults (light theme) and `[data-theme="dark"]` overrides
- CodeMirror 6 base overrides
- Shared component classes (math rendering, fenced div blocks, search panel, tooltips)
- `prefers-reduced-motion` and `prefers-contrast` media queries

It does **not** include Tailwind, app-shell layout, or print styles. Hosts should
not load KaTeX CSS separately for the standalone editor; `coflat/editor/style.css`
owns the math font contract.

### Dark mode

Set `data-theme="dark"` on `document.documentElement` (or any ancestor of the
editor mount point) to activate the dark token overrides:

```ts
document.documentElement.setAttribute("data-theme", "dark");
```

### Custom theme tokens

Override any `--cf-*` variable on the editor's parent element:

```css
.my-editor-wrapper {
  --cf-bg: #1e1e2e;
  --cf-fg: #cdd6f4;
  --cf-content-font: "EB Garamond", serif;
}
```

## Mount Options

```ts
const editor = mountEditor({
  parent,
  doc: "# Hello",
  mode: "rich",
  onChange: (doc) => {
    console.log(doc);
  },
  onModeChange: (mode) => {
    console.log(mode);
  },
});
```

Supported options:

- `parent: HTMLElement` mounts the editor into an existing DOM node.
- `doc?: string` seeds the initial markdown document. Default: empty string.
- `mode?: "rich" | "source"` selects the initial standalone mode. Default: `"rich"`.
- `extensions?: Extension[]` injects extra CodeMirror extensions from the host.
- `onChange?: (doc: string) => void` fires only for direct user edits.
- `onModeChange?: (mode: "rich" | "source") => void` fires when the effective mode changes.

## Controller Methods

- `getDoc()` returns the current document text.
- `setDoc(doc)` replaces the full document programmatically.
- `getMode()` returns the current standalone mode.
- `setMode(mode)` switches between `"rich"` and `"source"`.
- `focus()` focuses the mounted editor.
- `unmount()` destroys the CodeMirror view.

## Examples

### Callback-driven autosave

Wire `onChange` to persist the document after each edit:

```js
import "coflat/editor/style.css";
import { mountEditor } from "coflat/editor";

let saveTimer;

const editor = mountEditor({
  parent: document.getElementById("editor"),
  doc: loadDraft(),
  mode: "rich",
  onChange(doc) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraft(doc), 500);
  },
  onModeChange(mode) {
    console.log("mode:", mode);
  },
});
```

### Mode toggle

Build a toolbar that switches between rich and source editing:

```js
const editor = mountEditor({ parent, doc: "# Title" });

document.getElementById("rich-btn").addEventListener("click", () => {
  editor.setMode("rich");
});

document.getElementById("source-btn").addEventListener("click", () => {
  editor.setMode("source");
});
```

## Behavior Notes

- Standalone support is limited to rich and source modes.
- `setDoc()` is programmatic. It does not call `onChange`.
- App-shell concerns stay out of this surface: no tabs, file tree, status bar, Tauri filesystem, or React wrapper.
