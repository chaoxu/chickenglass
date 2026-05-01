import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { CslProcessor } from "../citations/csl-processor";
import { CSS } from "../constants/css-classes";
import { blockCounterField } from "../state/block-counter";
import { documentSemanticsField } from "../state/document-analysis";
import { pluginRegistryField, createPluginRegistryField } from "../state/plugin-registry";
import { fencedDiv } from "../parser/fenced-div";
import { mathExtension } from "../parser/math-backslash";
import { equationLabelExtension } from "../parser/equation-label";
import { frontmatterField } from "../state/frontmatter-state";
import {
  _computeReferenceDirtyRangesForTest as computeReferenceDirtyRanges,
  referenceRenderDependenciesChanged,
  referenceRenderPlugin,
} from "./reference-render";
import { createTestView } from "../test-utils";
import {
  createPluginView,
  karger,
  mockReferenceViewUpdate,
  store,
  stein,
  testPlugins,
} from "./reference-render-test-utils";

describe("collectReferenceRanges performance invalidation", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  describe("performance invalidation", () => {
    it("ignores unrelated semantic edits after all references", () => {
      const doc = [
        "::: {.theorem #thm-main}",
        "Statement.",
        ":::",
        "",
        "See [@thm-main] and [@karger2000].",
        "",
        "# Tail heading",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;

      view.dispatch({
        changes: {
          from: doc.indexOf("Tail"),
          to: doc.indexOf("Tail") + "Tail".length,
          insert: "Late",
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(false);
    });

    it("tracks equation renumbering even when references stay in place", () => {
      const doc = [
        "See [@eq:beta].",
        "",
        "$$a^2$$ {#eq:alpha}",
        "",
        "$$b^2$$ {#eq:beta}",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;
      const insert = "$$c^2$$ {#eq:middle}\n\n";
      const beforeSecondEquation = doc.indexOf("$$b^2$$");

      view.dispatch({
        changes: {
          from: beforeSecondEquation,
          insert,
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
    });

    it("tracks block renumbering even when references stay in place", () => {
      const doc = [
        "See [@thm-b].",
        "",
        "::: {.theorem #thm-a}",
        "A.",
        ":::",
        "",
        "::: {.theorem #thm-b}",
        "B.",
        ":::",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;
      const insert = [
        "::: {.theorem #thm-middle}",
        "Middle.",
        ":::",
        "",
      ].join("\n");
      const beforeSecondBlock = doc.indexOf("::: {.theorem #thm-b}");

      view.dispatch({
        changes: {
          from: beforeSecondBlock,
          insert,
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
    });

    it("rerenders heading refs when target numbering changes off the reference line", () => {
      const doc = [
        "# Intro",
        "",
        "## Result {#sec:result}",
        "",
        "See [@sec:result].",
      ].join("\n");

      view = createPluginView(doc, 0);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Section 1.1");

      const beforeState = view.state;
      const insert = [
        "## Earlier {#sec:earlier}",
        "",
      ].join("\n");
      const beforeTargetHeading = doc.indexOf("## Result");

      view.dispatch({
        changes: {
          from: beforeTargetHeading,
          insert,
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Section 1.2");
    });

    it("tracks block label changes from same-length frontmatter title edits", () => {
      const doc = [
        "---",
        "blocks:",
        "  theorem:",
        "    title: Result",
        "---",
        "",
        "::: {.theorem #thm-main}",
        "Statement.",
        ":::",
        "",
        "See [@thm-main].",
      ].join("\n");

      view = createPluginView(doc, 0);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Result 1");

      const beforeState = view.state;
      const labelStart = doc.indexOf("Result");

      view.dispatch({
        changes: {
          from: labelStart,
          to: labelStart + "Result".length,
          insert: "Remark",
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Remark 1");
    });

    it("rerenders existing block refs when the numbering scheme flips", () => {
      const originalDoc = [
        "---",
        "title: AB",
        "numbering: global",
        "---",
        "",
        "::: {.theorem #thm-a}",
        "A.",
        ":::",
        "",
        "::: {.definition #def-b}",
        "B.",
        ":::",
        "",
        "See [@def-b].",
      ].join("\n");
      const nextDoc = originalDoc
        .replace("title: AB", "title: A")
        .replace("numbering: global", "numbering: grouped");

      view = createPluginView(originalDoc, 0);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Definition 2");

      const beforeState = view.state;

      view.dispatch({
        changes: {
          from: 0,
          to: originalDoc.length,
          insert: nextDoc,
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(true);
      expect(view.dom.querySelector(`.${CSS.crossref}`)?.textContent).toBe("Definition 1");
    });

    it("treats pure block-numbering changes as render dependencies", () => {
      const originalDoc = [
        "---",
        "title: AB",
        "numbering: global",
        "---",
        "",
        "::: {.theorem #thm-a}",
        "A.",
        ":::",
        "",
        "::: {.definition #def-b}",
        "B.",
        ":::",
        "",
        "See [@def-b].",
      ].join("\n");
      const nextDoc = originalDoc
        .replace("title: AB", "title: A")
        .replace("numbering: global", "numbering: grouped");

      const beforeView = createPluginView(originalDoc, 0);
      const afterView = createPluginView(nextDoc, 0);
      const beforeAnalysis = beforeView.state.field(documentSemanticsField);
      const afterAnalysis = afterView.state.field(documentSemanticsField);

      (
        afterAnalysis as {
          references: typeof beforeAnalysis.references;
          referenceByFrom: typeof beforeAnalysis.referenceByFrom;
        }
      ).references = beforeAnalysis.references;
      (
        afterAnalysis as {
          references: typeof beforeAnalysis.references;
          referenceByFrom: typeof beforeAnalysis.referenceByFrom;
        }
      ).referenceByFrom = beforeAnalysis.referenceByFrom;

      const makeState = (
        analysis: typeof beforeAnalysis,
        baseState: EditorState,
      ): EditorState => ({
        field(field: unknown) {
          if (field === documentSemanticsField) return analysis;
          if (field === blockCounterField) return baseState.field(blockCounterField);
          if (field === pluginRegistryField) return baseState.field(pluginRegistryField);
          if (field === bibDataField) return baseState.field(bibDataField);
          return undefined;
        },
      }) as unknown as EditorState;

      const beforeState = makeState(beforeAnalysis, beforeView.state);
      const afterState = makeState(afterAnalysis, afterView.state);

      expect(referenceRenderDependenciesChanged(beforeState, afterState)).toBe(true);

      beforeView.destroy();
      afterView.destroy();
    });

    it("ignores equation body edits that preserve crossref numbering", () => {
      const doc = [
        "See [@eq:alpha].",
        "",
        "$$a^2$$ {#eq:alpha}",
        "",
        "Tail paragraph.",
      ].join("\n");

      view = createPluginView(doc, 0);
      const beforeState = view.state;
      const equationBodyStart = doc.indexOf("a^2");

      view.dispatch({
        changes: {
          from: equationBodyStart,
          to: equationBodyStart + "a^2".length,
          insert: "a^3",
        },
      });

      expect(referenceRenderDependenciesChanged(beforeState, view.state)).toBe(false);
    });

    it("does not re-register citations on navigation outside references", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = [
        "Intro text before citations.",
        "",
        "See [@karger2000].",
        "",
        "More plain text after citations.",
      ].join("\n");

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      view.dispatch({ selection: { anchor: doc.indexOf("More plain text") } });

      expect(registerSpy).not.toHaveBeenCalled();
      registerSpy.mockRestore();
    });

    it("does not re-register citations after unrelated semantic edits", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = [
        "See [@karger2000].",
        "",
        "# Tail heading",
      ].join("\n");

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      view.dispatch({
        changes: {
          from: doc.indexOf("Tail"),
          to: doc.indexOf("Tail") + "Tail".length,
          insert: "Late",
        },
      });

      expect(registerSpy).not.toHaveBeenCalled();
      registerSpy.mockRestore();
    });

    it("skips dirty reference rescans for plain prose inserts on lines without refs", () => {
      const doc = [
        "Plain intro text.",
        "",
        "See [@karger2000].",
      ].join("\n");

      view = createPluginView(doc, 0);
      const insertAt = doc.indexOf("intro") + "intro".length;
      const nextState = view.state.update({
        changes: {
          from: insertAt,
          insert: " more",
        },
      }).state;

      const update = mockReferenceViewUpdate(
        view.state,
        nextState,
        {
          from: insertAt,
          insert: " more",
        },
      );

      expect(computeReferenceDirtyRanges(update)).toEqual([]);
    });

    it("keeps dirty reference rescans when the changed line contains a ref", () => {
      const doc = [
        "See [@karger2000].",
        "",
        "Tail text.",
      ].join("\n");

      view = createPluginView(doc, 0);
      const insertAt = doc.indexOf("karger2000");
      const nextState = view.state.update({
        changes: {
          from: insertAt,
          insert: "x",
        },
      }).state;

      const update = mockReferenceViewUpdate(
        view.state,
        nextState,
        {
          from: insertAt,
          insert: "x",
        },
      );

      expect(computeReferenceDirtyRanges(update).length).toBeGreaterThan(0);
    });

    it("re-registers citations when bibliography data changes", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = "See [@karger2000; @stein2001].";

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      view.dispatch({
        effects: bibDataEffect.of({
          store,
          cslProcessor: new CslProcessor([karger, stein]),
        }),
      });

      expect(registerSpy).toHaveBeenCalledTimes(1);
      registerSpy.mockRestore();
    });

    it("re-registers citations when the same processor is reused after setStyle()", async () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = "See [@karger2000; @stein2001].";
      const processor = await CslProcessor.create([karger, stein]);

      view = createTestView(doc, {
        cursorPos: 0,
        extensions: [
          markdown({
            extensions: [fencedDiv, mathExtension, equationLabelExtension],
          }),
          frontmatterField,
          documentSemanticsField,
          createPluginRegistryField(testPlugins),
          blockCounterField,
          bibDataField,
          referenceRenderPlugin,
        ],
      });
      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: processor }) });
      registerSpy.mockClear();

      await processor.setStyle("<style>invalid</style>");
      view.dispatch({ effects: bibDataEffect.of({ store, cslProcessor: processor }) });

      expect(registerSpy).toHaveBeenCalledTimes(1);
      registerSpy.mockRestore();
    });

    it("re-registers citations when document edits change citation order", () => {
      const registerSpy = vi.spyOn(CslProcessor.prototype, "registerCitations");
      const doc = "See [@karger2000] then [@stein2001].";

      view = createPluginView(doc, 0);
      registerSpy.mockClear();

      const first = "[@karger2000]";
      const second = "[@stein2001]";
      const firstStart = doc.indexOf(first);
      const secondStart = doc.indexOf(second);

      view.dispatch({
        changes: {
          from: firstStart,
          to: secondStart + second.length,
          insert: `${second} then ${first}`,
        },
      });

      expect(registerSpy).toHaveBeenCalledTimes(1);
      registerSpy.mockRestore();
    });
  });
});
