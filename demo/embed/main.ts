/**
 * Minimal demo of the coflat standalone editor API.
 *
 * In a consumer project you would write:
 *   import "coflat/editor/style.css";
 *   import { mountEditor } from "coflat/editor";
 *
 * Here we import from source so the demo runs with `npm run dev`.
 */
import "../../src/editor-theme.css";
import { mountEditor } from "../../editor";

// ---------------------------------------------------------------------------
// Sample document
// ---------------------------------------------------------------------------

const sampleDoc = `# Euler's Identity

The equation $e^{i\\pi} + 1 = 0$ unifies five fundamental constants.

::: {.theorem} Euler's Formula
For any real number $x$:

$$e^{ix} = \\cos x + i \\sin x$$
:::

::: {.proof}
Apply Taylor series for $e^z$, $\\cos x$, and $\\sin x$, then compare terms.
:::
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

const logEl = $("log-output");

function log(msg: string): void {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Mount the editor
// ---------------------------------------------------------------------------

const richBtn = $("mode-rich");
const sourceBtn = $("mode-source");

function updateModeButtons(mode: string): void {
  richBtn.classList.toggle("active", mode === "rich");
  sourceBtn.classList.toggle("active", mode === "source");
}

const editor = mountEditor({
  parent: $("editor"),
  doc: sampleDoc,
  mode: "rich",
  onChange(doc) {
    log(`onChange \u2013 ${doc.length} chars`);
  },
  onModeChange(mode) {
    log(`onModeChange \u2013 ${mode}`);
    updateModeButtons(mode);
  },
});

log("Editor mounted");

// ---------------------------------------------------------------------------
// Toolbar wiring
// ---------------------------------------------------------------------------

richBtn.addEventListener("click", () => {
  editor.setMode("rich");
  updateModeButtons("rich");
});

sourceBtn.addEventListener("click", () => {
  editor.setMode("source");
  updateModeButtons("source");
});

$("get-doc").addEventListener("click", () => {
  log(`getDoc() \u2013 ${editor.getDoc().length} chars`);
});
