# Standalone Editor API

`coflat/editor` exposes the editor core without the Coflat app shell.

## Import

```ts
import { mountEditor } from "coflat/editor";
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

## Behavior Notes

- Standalone support is limited to rich and source modes.
- `setDoc()` is programmatic. It does not call `onChange`.
- App-shell concerns stay out of this surface: no tabs, file tree, status bar, Tauri filesystem, or React wrapper.
