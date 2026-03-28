# Standalone Editor API

`coflat/editor` exposes the editor core without the Coflat app shell.

## Install

```bash
npm install coflat
```

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

A runnable demo is in [`demo/embed/`](../demo/embed/) — start the dev server
(`npm run dev`) and open `/demo/embed/`.

## Import

```ts
import "coflat/editor/style.css";
import { mountEditor } from "coflat/editor";
```

The CSS import is required. It provides:

- `--cf-*` design token defaults (light theme) and `[data-theme="dark"]` overrides
- CodeMirror 6 base overrides
- Shared component classes (math rendering, fenced div blocks, search panel, tooltips)
- `prefers-reduced-motion` and `prefers-contrast` media queries

It does **not** include Tailwind, app-shell layout, or print styles.

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
