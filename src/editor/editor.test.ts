import { describe, expect, it } from "vitest";
import {
  createEditor,
  editorModeField,
  markdownEditorModes,
  normalizeEditorMode,
  setEditorMode,
} from "./editor";
import { frontmatterField } from "./frontmatter-state";
import { documentSemanticsField } from "../state/document-analysis";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import { blockCounterField } from "../state/block-counter";
import { bibDataField } from "../citations/citation-render";
import { documentLabelGraphField } from "../state/document-label-graph";
import { imageUrlField } from "../state/image-url";
import { includeRegionsField } from "../state/include-regions";
import { pdfPreviewField } from "../state/pdf-preview";

describe("createEditor", () => {
  it("creates an editor view attached to the given parent", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent });

    expect(view.dom.parentElement).toBe(parent);
    expect(view.state.doc.length).toBeGreaterThan(0);

    view.destroy();
  });

  it("uses provided doc content", () => {
    const parent = document.createElement("div");
    const doc = "# Test";
    const view = createEditor({ parent, doc });

    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
  });
});

describe("editorModeField", () => {
  // Regression: cycleEditorMode used a module-level `currentMode` variable that
  // didn't stay in sync when the app switched modes programmatically (e.g.
  // opening a non-markdown file). The fix stores mode in a CM6 StateField so
  // any consumer can read the authoritative current mode. See #346.
  it("defaults to 'rich' mode", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent });
    expect(view.state.field(editorModeField)).toBe("rich");
    view.destroy();
  });

  it("updates when setEditorMode is called", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent });

    setEditorMode(view, "source");
    expect(view.state.field(editorModeField)).toBe("source");

    setEditorMode(view, "read");
    expect(view.state.field(editorModeField)).toBe("read");

    setEditorMode(view, "rich");
    expect(view.state.field(editorModeField)).toBe("rich");

    view.destroy();
  });

  it("reflects mode set by React shell before keyboard cycle", () => {
    // Simulate the app switching the mode to 'source' (e.g. non-markdown file),
    // then the user pressing the cycle key. The field must return 'source' so
    // the cycle continues from there, not from the stale module-level default.
    const parent = document.createElement("div");
    const view = createEditor({ parent });

    // App sets mode to source
    setEditorMode(view, "source");

    // Read the field — must reflect what the app set
    expect(view.state.field(editorModeField)).toBe("source");

    view.destroy();
  });
});

describe("extension bundle composition", () => {
  it("installs all document state fields from coreDocumentStateExtensions", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent, doc: "# Hello\n" });

    // Each field is queryable — proves the bundle installed them in order
    expect(view.state.field(frontmatterField)).toBeDefined();
    expect(view.state.field(includeRegionsField)).toBeDefined();
    expect(view.state.field(documentSemanticsField)).toBeDefined();
    expect(view.state.field(blockCounterField)).toBeDefined();
    expect(view.state.field(documentReferenceCatalogField)).toBeDefined();
    expect(view.state.field(documentLabelGraphField)).toBeDefined();
    expect(view.state.field(bibDataField)).toBeDefined();
    expect(view.state.field(pdfPreviewField)).toBeDefined();
    expect(view.state.field(imageUrlField)).toBeDefined();

    view.destroy();
  });

  it("installs render mode compartments that support mode cycling", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent, doc: "# Hello\n" });

    // Cycle through all three modes — proves compartments are wired correctly
    for (const mode of ["source", "read", "rich"] as const) {
      setEditorMode(view, mode);
      expect(view.state.field(editorModeField)).toBe(mode);
    }

    view.destroy();
  });

  it("keeps the reference catalog stable across unrelated inline-math edits", () => {
    const parent = document.createElement("div");
    const doc = [
      "# Heading {#sec:one}",
      "",
      "See [@sec:one] and $x$.",
      "",
    ].join("\n");
    const view = createEditor({ parent, doc });
    const before = view.state.field(documentReferenceCatalogField);
    const mathFrom = view.state.doc.toString().indexOf("$x$") + 1;

    view.dispatch({
      changes: { from: mathFrom, to: mathFrom + 1, insert: "y" },
      selection: { anchor: mathFrom + 1 },
    });

    expect(view.state.field(documentReferenceCatalogField)).toBe(before);

    view.destroy();
  });
});

describe("normalizeEditorMode", () => {
  it("disables read mode for markdown files", () => {
    expect(normalizeEditorMode("read", true)).toBe("rich");
    expect(markdownEditorModes).toEqual(["rich", "source"]);
  });

  it("forces non-markdown files into source mode", () => {
    expect(normalizeEditorMode("rich", false)).toBe("source");
    expect(normalizeEditorMode("read", false)).toBe("source");
  });
});
