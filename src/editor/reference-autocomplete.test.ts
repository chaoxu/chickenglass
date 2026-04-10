import {
  CompletionContext,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { CslProcessor } from "../citations/csl-processor";
import { bibDataEffect, bibDataField } from "../citations/citation-render";
import {
  defaultPlugins,
} from "../plugins";
import { documentAnalysisField } from "../semantics/codemirror-source";
import { blockCounterField } from "../state/block-counter";
import { createPluginRegistryField } from "../state/plugin-registry";
import { CSL_FIXTURES, makeBibStore } from "../test-utils";
import {
  createMarkdownLanguageExtensions,
} from "./base-editor-extensions";
import { createEditor } from "./editor";
import { frontmatterField } from "./frontmatter-state";
import {
  collectReferenceCompletionCandidates,
  findReferenceCompletionMatch,
  referenceCompletionSource,
} from "./reference-autocomplete";

async function waitForCompletionLabels(
  readLabels: () => readonly string[],
): Promise<readonly string[]> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const labels = readLabels();
    if (labels.length > 0) {
      return labels;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readLabels();
}

async function waitForCompletionItem(
  predicate: (item: HTMLLIElement) => boolean,
): Promise<HTMLLIElement | undefined> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const item = [...document.querySelectorAll<HTMLLIElement>(".cm-tooltip-autocomplete li")]
      .find(predicate);
    if (item) {
      return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return [...document.querySelectorAll<HTMLLIElement>(".cm-tooltip-autocomplete li")]
    .find(predicate);
}

function createReferenceState(doc: string): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [
      ...createMarkdownLanguageExtensions(),
      frontmatterField,
      documentAnalysisField,
      createPluginRegistryField(defaultPlugins),
      blockCounterField,
      bibDataField,
    ],
  });
}

function typeText(view: ReturnType<typeof createEditor>, text: string): void {
  const from = view.state.selection.main.from;
  const to = view.state.selection.main.to;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.type",
  });
}

describe("findReferenceCompletionMatch", () => {
  it("detects bracketed references at [@", () => {
    const state = createReferenceState("See [@thm");
    expect(findReferenceCompletionMatch(state, state.doc.length)).toEqual({
      kind: "bracketed",
      from: 6,
      to: 9,
      query: "thm",
    });
  });

  it("detects the active slot inside clustered bracketed references", () => {
    const state = createReferenceState("See [@eq:one; @thm");
    expect(findReferenceCompletionMatch(state, state.doc.length)).toEqual({
      kind: "bracketed",
      from: 15,
      to: 18,
      query: "thm",
    });
  });

  it("detects narrative references at @", () => {
    const state = createReferenceState("As @thm");
    expect(findReferenceCompletionMatch(state, state.doc.length)).toEqual({
      kind: "narrative",
      from: 4,
      to: 7,
      query: "thm",
    });
  });

  it("does not trigger inside locators", () => {
    const state = createReferenceState("See [@thm:main, p. 10]");
    expect(findReferenceCompletionMatch(state, "See [@thm:main, p.".length)).toBeNull();
  });

  it("does not trigger inside email addresses", () => {
    const state = createReferenceState("Contact test@example.com");
    expect(findReferenceCompletionMatch(state, state.doc.length)).toBeNull();
  });

  it("does not trigger inside inline code", () => {
    const state = createReferenceState("`@thm`");
    expect(findReferenceCompletionMatch(state, 5)).toBeNull();
  });
});

describe("collectReferenceCompletionCandidates", () => {
  it("collects blocks, equations, headings, and citations with semantic precedence", () => {
    const state = createReferenceState(
      [
        "# Background {#sec:background}",
        "",
        "::: {#thm:main .theorem} Fundamental theorem",
        "Statement.",
        ":::",
        "",
        "$$",
        "E = mc^2",
        "$$ {#eq:energy}",
      ].join("\n"),
    ).update({
      effects: bibDataEffect.of({
        store: makeBibStore([
          CSL_FIXTURES.karger,
          { ...CSL_FIXTURES.stein, id: "thm:main" },
        ]),
        cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
      }),
    }).state;

    const byId = new Map(
      collectReferenceCompletionCandidates(state).map((candidate) => [candidate.id, candidate]),
    );

    expect(byId.get("thm:main")).toMatchObject({
      kind: "block",
      detail: "Theorem 1",
      info: "Fundamental theorem",
    });
    expect(byId.get("eq:energy")).toMatchObject({
      kind: "equation",
      detail: "Eq. (1)",
    });
    expect(byId.get("sec:background")).toMatchObject({
      kind: "heading",
      detail: "Section 1",
      info: "Background",
    });
    expect(byId.get("karger2000")).toMatchObject({
      kind: "citation",
      detail: "Karger 2000",
      preview: "Karger, David R.. Minimum cuts in near-linear time. JACM, 47(1), 46-76. 2000.",
    });
    expect(byId.size).toBe(4);
  });
});

describe("referenceCompletionSource", () => {
  it("offers semantic and bibliography ids after [@", async () => {
    const state = createReferenceState(
      [
        "# Background {#sec:background}",
        "",
        "::: {#thm:main .theorem}",
        "Statement.",
        ":::",
        "",
        "See [@",
      ].join("\n"),
    ).update({
      effects: bibDataEffect.of({
        store: makeBibStore([CSL_FIXTURES.karger]),
        cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
      }),
    }).state;

    const result = await referenceCompletionSource(
      // explicit completion mirrors Mod-Space and direct test invocation
      new CompletionContext(state, state.doc.length, true),
    );

    expect(result).not.toBeNull();
    expect(result?.from).toBe(state.doc.length);
    const labels = result ? result.options.map((option) => option.label) : [];
    expect(labels).toEqual(
      expect.arrayContaining(["thm:main", "sec:background", "karger2000"]),
    );
  });
});

describe("reference autocomplete integration", () => {
  it("is wired into createEditor for semantic and bibliography ids", async () => {
    const doc = [
      "# Background {#sec:background}",
      "",
      "::: {#thm:main .theorem}",
      "Statement.",
      ":::",
      "",
      "See [@",
    ].join("\n");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createEditor({ parent, doc });
    view.focus();

    view.dispatch({
      effects: bibDataEffect.of({
        store: makeBibStore([CSL_FIXTURES.karger]),
        cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
      }),
    });
    view.dispatch({
      selection: { anchor: view.state.doc.length },
    });

    expect(startCompletion(view)).toBe(true);
    const labels = await waitForCompletionLabels(() =>
      currentCompletions(view.state).map((completion) => completion.label),
    );
    expect(labels).toEqual(
      expect.arrayContaining(["thm:main", "sec:background", "karger2000"]),
    );

    view.destroy();
    parent.remove();
  }, 15_000);

  it("opens on live bare @ typing when semantic references are available", async () => {
    const doc = [
      "# Background {#sec:background}",
      "",
      "::: {#thm:main .theorem}",
      "Statement.",
      ":::",
      "",
      "See ",
    ].join("\n");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createEditor({ parent, doc });
    view.focus();
    view.dispatch({
      selection: { anchor: view.state.doc.length },
    });

    typeText(view, "@");
    const labels = await waitForCompletionLabels(() =>
      currentCompletions(view.state).map((completion) => completion.label),
    );
    expect(labels).toEqual(
      expect.arrayContaining(["thm:main", "sec:background"]),
    );

    view.destroy();
    parent.remove();
  });

  it("reopens bare @ completion when bibliography data arrives after typing", async () => {
    const doc = "See ";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createEditor({ parent, doc });
    view.focus();
    view.dispatch({
      selection: { anchor: view.state.doc.length },
    });

    typeText(view, "@");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(currentCompletions(view.state)).toHaveLength(0);

    view.dispatch({
      effects: bibDataEffect.of({
        store: makeBibStore([CSL_FIXTURES.karger]),
        cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
      }),
    });

    const labels = await waitForCompletionLabels(() =>
      currentCompletions(view.state).map((completion) => completion.label),
    );
    expect(labels).toContain("karger2000");

    view.destroy();
    parent.remove();
  });

  it("renders citation completions as preview cards without detached info tooltips", async () => {
    const doc = "See [@";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createEditor({ parent, doc });
    view.focus();

    view.dispatch({
      effects: bibDataEffect.of({
        store: makeBibStore([CSL_FIXTURES.karger]),
        cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
      }),
    });
    view.dispatch({
      selection: { anchor: view.state.doc.length },
    });

    expect(startCompletion(view)).toBe(true);
    await waitForCompletionLabels(() =>
      currentCompletions(view.state).map((candidate) => candidate.label),
    );
    const [completion] = currentCompletions(view.state);
    expect(completion?.label).toBe("karger2000");
    expect(completion?.info).toBeUndefined();

    const item = await waitForCompletionItem((candidate) =>
      candidate.textContent?.includes("karger2000") ?? false,
    );
    expect(item).toBeTruthy();
    expect(item?.className).toContain("cf-reference-completion-citation");
    expect(item?.querySelector(".cm-completionLabel")?.textContent).toBe("karger2000");
    expect(item?.querySelector(".cm-completionDetail")?.textContent).toBe("Karger 2000");
    expect(item?.querySelector(".cf-citation-preview")?.textContent).toContain(
      "Minimum cuts in near-linear time. JACM, 47(1), 46-76. 2000.",
    );
    expect(document.querySelector(".cm-completionInfo")).toBeNull();

    view.destroy();
    parent.remove();
  });

  it("renders semantic cross-reference completions as inline previews without detached info tooltips", async () => {
    const doc = [
      "# Background {#sec:background}",
      "",
      "::: {#thm:main .theorem} Fundamental theorem",
      "Statement with $x^2$ inline math.",
      ":::",
      "",
      "::: {#tbl:results .table} Results table",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      ":::",
      "",
      "$$",
      "E = mc^2",
      "$$ {#eq:energy}",
      "",
      "See [@",
    ].join("\n");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createEditor({ parent, doc });
    view.focus();
    view.dispatch({
      selection: { anchor: view.state.doc.length },
    });

    expect(startCompletion(view)).toBe(true);
    await waitForCompletionLabels(() =>
      currentCompletions(view.state).map((candidate) => candidate.label),
    );

    const completionByLabel = new Map(
      currentCompletions(view.state).map((completion) => [completion.label, completion]),
    );
    expect(completionByLabel.get("thm:main")?.info).toBeUndefined();
    expect(completionByLabel.get("tbl:results")?.info).toBeUndefined();
    expect(completionByLabel.get("eq:energy")?.info).toBeUndefined();
    expect(completionByLabel.get("sec:background")?.info).toBeUndefined();

    const theoremItem = await waitForCompletionItem((candidate) =>
      candidate.querySelector(".cm-completionDetail")?.textContent === "thm:main",
    );
    expect(theoremItem?.className).toContain("cf-reference-completion-crossref");
    expect(theoremItem?.querySelector(".cm-completionLabel")?.textContent).toBe("Fundamental theorem");
    const theoremPreview = theoremItem?.querySelector(".cf-reference-completion-content");
    expect(theoremPreview).toBeTruthy();
    expect(theoremPreview?.firstElementChild?.className).toContain("cf-hover-preview-body");
    expect(theoremPreview?.querySelector(".cf-reference-completion-meta")?.textContent)
      .toContain("Theorem 1");
    expect(theoremItem?.textContent).toContain("Statement with");
    expect(theoremItem?.querySelector(".katex")).toBeTruthy();

    const tableItem = await waitForCompletionItem((candidate) =>
      candidate.querySelector(".cm-completionDetail")?.textContent === "tbl:results",
    );
    expect(tableItem?.querySelector(".cm-completionLabel")?.textContent).toBe("Results table");
    expect(tableItem?.querySelector(".cf-reference-completion-content")?.firstElementChild?.className)
      .toContain("cf-hover-preview-body");
    expect(tableItem?.querySelector(".cf-reference-completion-meta")?.textContent).toContain("Table");
    expect(tableItem?.querySelector(".cf-hover-preview-table-scroll table")).toBeTruthy();
    expect(tableItem?.textContent).toContain("Results table");

    const equationItem = await waitForCompletionItem((candidate) =>
      candidate.querySelector(".cm-completionDetail")?.textContent === "eq:energy",
    );
    expect(equationItem?.querySelector(".cm-completionLabel")?.textContent).toBe("Eq. (1)");
    const equationPreview = equationItem?.querySelector(".cf-reference-completion-content");
    expect(equationPreview?.firstElementChild?.className).toContain("cf-hover-preview-body");
    expect(equationPreview?.querySelector(".cf-reference-completion-meta")?.textContent)
      .toBe("Eq. (1)");
    expect(equationItem?.querySelector(".katex-display")).toBeTruthy();

    const headingItem = await waitForCompletionItem((candidate) =>
      candidate.querySelector(".cm-completionDetail")?.textContent === "sec:background",
    );
    expect(headingItem?.querySelector(".cm-completionLabel")?.textContent).toBe("Background");
    const headingPreview = headingItem?.querySelector(".cf-reference-completion-content");
    expect(headingPreview?.firstElementChild?.className).toContain("cf-hover-preview-header");
    expect(headingPreview?.querySelector(".cf-reference-completion-meta")).toBeNull();
    expect(headingItem?.textContent).toContain("Section 1 Background");
    expect(headingItem?.querySelector(".cf-hover-preview-header")).toBeTruthy();

    expect(document.querySelector(".cm-completionInfo")).toBeNull();

    view.destroy();
    parent.remove();
  });

  it("keeps nested citations compact inside semantic completion previews", async () => {
    const doc = [
      "::: {#thm:main .theorem} Compact theorem",
      "Statement cites [@karger2000].",
      ":::",
      "",
      "See [@",
    ].join("\n");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = createEditor({ parent, doc });
    view.focus();

    view.dispatch({
      effects: bibDataEffect.of({
        store: makeBibStore([CSL_FIXTURES.karger]),
        cslProcessor: new CslProcessor([CSL_FIXTURES.karger]),
      }),
    });
    view.dispatch({
      selection: { anchor: view.state.doc.length },
    });

    expect(startCompletion(view)).toBe(true);
    await waitForCompletionLabels(() =>
      currentCompletions(view.state).map((candidate) => candidate.label),
    );

    const theoremItem = await waitForCompletionItem((candidate) =>
      candidate.querySelector(".cm-completionDetail")?.textContent === "thm:main",
    );

    expect(theoremItem?.querySelector(".cf-bibliography")).toBeNull();
    expect(theoremItem?.textContent).not.toContain("Minimum cuts in near-linear time");
    expect(theoremItem?.textContent).toContain("Statement cites");

    view.destroy();
    parent.remove();
  });
});
