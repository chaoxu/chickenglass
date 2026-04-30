import { describe, expect, it } from "vitest";
import type { EditorRuntimeContractSnapshot, RuntimeContractElementSnapshot } from "./editor-runtime-contract";
import { evaluateEditorRuntimeContract } from "./editor-runtime-contract";

function visibleElement(
  selector: string,
  overrides: Partial<RuntimeContractElementSnapshot> = {},
): RuntimeContractElementSnapshot {
  return {
    selector,
    className: "",
    text: "text",
    rect: {
      left: 0,
      top: 0,
      width: 800,
      height: 400,
      right: 800,
      bottom: 400,
    },
    style: {
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(0, 0, 0)",
      display: "block",
      fontFamily: "KaTeX_Main",
      fontSize: "16px",
      lineHeight: "24px",
      marginLeft: "auto",
      marginRight: "224px",
      maxWidth: "800px",
      opacity: "1",
      overflow: "auto",
      paddingBottom: "24px",
      paddingLeft: "48px",
      paddingRight: "48px",
      paddingTop: "24px",
      visibility: "visible",
    },
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<Omit<EditorRuntimeContractSnapshot, "issues">> = {},
): Omit<EditorRuntimeContractSnapshot, "issues"> {
  return {
    href: "http://localhost:5173/",
    title: "Coflats",
    mode: "cm6-rich",
    bodyText: "text",
    docLength: 12,
    fonts: {
      status: "loaded",
      katexMainLoaded: true,
      fontUrl: "/assets/KaTeX_Main-Regular.woff2",
      fontFetch: { ok: true, status: 200 },
    },
    counts: {
      cmEditor: 1,
      cmScroller: 1,
      cmContent: 1,
      cmLine: 1,
      cmBlockWidget: 0,
      katex: 0,
      lexicalEditor: 0,
    },
    elements: {
      app: visibleElement("#app"),
      editor: visibleElement(".cm-editor", { style: { ...visibleElement(".cm-editor").style, display: "flex" } }),
      scroller: visibleElement(".cm-scroller", { style: { ...visibleElement(".cm-scroller").style, display: "flex" } }),
      content: visibleElement(".cm-content"),
      firstLine: visibleElement(".cm-line"),
      katex: null,
      lexical: null,
    },
    ...overrides,
  };
}

describe("editor runtime contract", () => {
  it("accepts a healthy CM6 surface", () => {
    expect(evaluateEditorRuntimeContract(snapshot())).toEqual([]);
  });

  it("accepts a CM6 document that is fully represented by block widgets", () => {
    expect(evaluateEditorRuntimeContract(snapshot({
      counts: {
        ...snapshot().counts,
        cmLine: 0,
        cmBlockWidget: 1,
      },
      elements: {
        ...snapshot().elements,
        firstLine: null,
      },
    }))).toEqual([]);
  });

  it("flags the Tauri CM6 layout drift that pushes content out of view", () => {
    const issues = evaluateEditorRuntimeContract(snapshot({
      elements: {
        ...snapshot().elements,
        editor: visibleElement(".cm-editor", {
          style: { ...visibleElement(".cm-editor").style, display: "block" },
        }),
        content: visibleElement(".cm-content", {
          rect: {
            left: 0,
            top: 18_242,
            width: 800,
            height: 36_384,
            right: 800,
            bottom: 54_626,
          },
        }),
      },
    }));

    expect(issues).toContain("CM6 editor display must be flex, got block");
    expect(issues).toContain("CM6 content is displaced below viewport by 18242px");
  });

  it("flags CM6 document-column drift even when the editor is visible", () => {
    const issues = evaluateEditorRuntimeContract(snapshot({
      elements: {
        ...snapshot().elements,
        content: visibleElement(".cm-content", {
          rect: {
            left: 233,
            top: 0,
            width: 949,
            height: 11_668,
            right: 1182,
            bottom: 11_668,
          },
          style: {
            ...visibleElement(".cm-content").style,
            marginLeft: "0px",
            maxWidth: "none",
          },
        }),
      },
    }));

    expect(issues).toContain("CM6 content max-width must be 800px, got none");
    expect(issues).toContain("CM6 content must keep the shared document column left margin");
  });

  it("accepts a healthy Lexical surface", () => {
    expect(evaluateEditorRuntimeContract(snapshot({
      mode: "lexical",
      counts: {
        cmEditor: 0,
        cmScroller: 0,
        cmContent: 0,
        cmLine: 0,
        cmBlockWidget: 0,
        katex: 0,
        lexicalEditor: 1,
      },
      elements: {
        ...snapshot().elements,
        editor: null,
        scroller: null,
        content: null,
        firstLine: null,
        lexical: visibleElement(".cf-lexical-editor"),
      },
    }))).toEqual([]);
  });

  it("flags broken KaTeX font state when math exists", () => {
    expect(evaluateEditorRuntimeContract(snapshot({
      counts: {
        ...snapshot().counts,
        katex: 1,
      },
      elements: {
        ...snapshot().elements,
        katex: visibleElement(".katex"),
      },
      fonts: {
        status: "loaded",
        katexMainLoaded: false,
        fontUrl: "/assets/KaTeX_Main-Regular.woff2",
        fontFetch: { ok: false, status: 404 },
      },
    }))).toEqual([
      "KaTeX_Main font is not loaded",
      "KaTeX font fetch failed: 404",
    ]);
  });
});
