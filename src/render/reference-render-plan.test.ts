import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { bibDataField } from "../state/bib-data";
import {
  planReferenceRendering,
  type ReferenceRenderItem,
} from "./reference-render";
import { createView, store } from "./reference-render-test-utils";


describe("planReferenceRendering", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function plan(doc: string, cursorPos?: number): ReferenceRenderItem[] {
    view = createView(doc, cursorPos ?? doc.length);
    const { cslProcessor } = view.state.field(bibDataField);
    return planReferenceRendering(view, store, cslProcessor);
  }

  function findPlan(items: ReferenceRenderItem[], text: string): ReferenceRenderItem | undefined {
    return items.find((item) => view.state.sliceDoc(item.from, item.to) === text);
  }

  it("routes bracketed block reference to crossref plan", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@thm-main]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("crossref");
  });

  it("routes heading and fenced block references with distinct resolved kinds", () => {
    const doc = [
      "# Intro",
      "",
      "## Result Section {#sec:result}",
      "",
      "::: {.theorem #thm-result}",
      "Statement.",
      ":::",
      "",
      "See [@sec:result] and [@thm-result].",
    ].join("\n");
    const items = plan(doc);
    const heading = findPlan(items, "[@sec:result]");
    const block = findPlan(items, "[@thm-result]");

    expect(heading?.kind).toBe("crossref");
    expect(block?.kind).toBe("crossref");
    if (heading?.kind === "crossref") {
      expect(heading.resolved.kind).toBe("heading");
    }
    if (block?.kind === "crossref") {
      expect(block.resolved.kind).toBe("block");
    }
  });

  it("routes bracketed local target before same-id citation", () => {
    const doc = [
      "::: {.theorem #karger2000}",
      "Statement.",
      ":::",
      "",
      "See [@karger2000].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@karger2000]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("crossref");
    if (item?.kind === "crossref") {
      expect(item?.resolved.label).toBe("Theorem 1");
    }
  });

  it("routes bracketed citation to citation plan", () => {
    const items = plan("See [@karger2000] for details.");
    const item = findPlan(items, "[@karger2000]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("citation");
    if (item?.kind === "citation") {
      expect(item?.narrative).toBe(false);
    }
  });

  it("routes narrative bib reference to narrative citation plan", () => {
    const items = plan("As @karger2000 showed.");
    const item = findPlan(items, "@karger2000");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("citation");
    if (item?.kind === "citation") {
      expect(item?.narrative).toBe(true);
    }
  });

  it("routes unknown bracketed id to unresolved plan", () => {
    const items = plan("See [@unknown-thing].");
    const item = findPlan(items, "[@unknown-thing]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("unresolved");
  });

  it("routes focused cursor reveal to source-mark plan", () => {
    const doc = [
      "::: {.theorem #thm-1}",
      "T1.",
      ":::",
      "",
      "See [@thm-1].",
    ].join("\n");
    const refStart = doc.indexOf("[@thm-1]");
    const items = plan(doc, refStart + 3);
    const item = items.find((i) => i.from === refStart);
    expect(item).toBeDefined();
    expect(item?.kind).toBe("source-mark");
  });

  it("routes mixed crossref+citation to mixed-cluster plan", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@eq:alpha; @karger2000]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("mixed-cluster");
  });

  it("routes clustered equation crossrefs to clustered-crossref plan", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@eq:alpha; @eq:beta]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("clustered-crossref");
  });

  it("keeps unresolved items inside clustered-crossref plans", () => {
    const doc = [
      "::: {.theorem #thm-a}",
      "A.",
      ":::",
      "",
      "See [@thm-a; @missing].",
    ].join("\n");
    const items = plan(doc);
    const item = findPlan(items, "[@thm-a; @missing]");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("clustered-crossref");
    if (!item || item.kind !== "clustered-crossref") return;
    expect(item.parts).toEqual([
      { id: "thm-a", text: "Theorem 1" },
      { id: "missing", text: "missing", unresolved: true },
    ]);
  });

  it("skips narrative refs that resolve to neither crossref nor citation", () => {
    const items = plan("As @unknown-thing goes.");
    expect(items).toHaveLength(0);
  });
});
