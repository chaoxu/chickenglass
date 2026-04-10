# Standalone Editor API

`coflat/editor` exposes the Lexical editor surface without the Coflat app shell.

## Install

```bash
npm install coflat
```

## Quick start

```js
import "coflat/editor/style.css";
import { mountEditor } from "coflat/editor";

const editor = mountEditor({
  parent: document.getElementById("editor"),
  doc: "# Hello\n\nEdit me.",
  mode: "lexical",
});

console.log(editor.getDoc());
editor.setMode("source");
editor.unmount();
```

## CSS import

The CSS import is required. It provides:

- `--cf-*` theme token defaults
- Lexical editor surface styles
- shared content/theme classes used by the standalone surface

It does not include Tailwind, app-shell layout, or print styles.

## Mount options

- `parent: HTMLElement`
- `doc?: string`
- `mode?: "lexical" | "source"`; default `"lexical"`
- `onChange?: (doc: string) => void`
- `onModeChange?: (mode: "lexical" | "source") => void`

## Controller methods

- `getDoc()`
- `setDoc(doc)`
- `getMode()`
- `setMode(mode)`
- `focus()`
- `unmount()`

## Behavior notes

- Standalone support is limited to Lexical and source modes.
- `setDoc()` is programmatic and does not call `onChange`.
- App-shell concerns stay out of this surface: no tabs, file tree, status bar, Tauri filesystem, or dialogs.
