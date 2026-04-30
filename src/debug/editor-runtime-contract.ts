import type { EditorMode } from "../editor-display-mode";
import { isCm6EditorMode, isLexicalEditorMode } from "../editor-display-mode";
import { isTauri } from "../lib/tauri";

export const TAURI_RENDER_DIAGNOSTICS_KEY = "cf-tauri-render-diagnostics";
const ROOT_CM_EDITOR_SELECTOR = ".cm-editor.cf-doc-surface--cm6";
const ROOT_CM_SCROLLER_SELECTOR = `${ROOT_CM_EDITOR_SELECTOR} > .cm-scroller`;
const ROOT_CM_CONTENT_SELECTOR = ".cm-content.cf-doc-flow--cm6";

export interface RuntimeContractElementSnapshot {
  readonly selector: string;
  readonly className: string;
  readonly text: string;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly style: {
    readonly backgroundColor: string;
    readonly color: string;
    readonly display: string;
    readonly fontFamily: string;
    readonly fontSize: string;
    readonly lineHeight: string;
    readonly marginLeft: string;
    readonly marginRight: string;
    readonly maxWidth: string;
    readonly opacity: string;
    readonly overflow: string;
    readonly paddingBottom: string;
    readonly paddingLeft: string;
    readonly paddingRight: string;
    readonly paddingTop: string;
    readonly visibility: string;
  };
}

export interface EditorRuntimeContractSnapshot {
  readonly href: string;
  readonly title: string;
  readonly mode: EditorMode | null;
  readonly bodyText: string;
  readonly docLength: number | null;
  readonly fonts: {
    readonly status: string | null;
    readonly katexMainLoaded: boolean | null;
    readonly fontUrl: string | null;
    readonly fontFetch: Record<string, unknown> | null;
  };
  readonly counts: {
    readonly cmEditor: number;
    readonly cmScroller: number;
    readonly cmContent: number;
    readonly cmLine: number;
    readonly cmBlockWidget: number;
    readonly katex: number;
    readonly lexicalEditor: number;
  };
  readonly elements: {
    readonly app: RuntimeContractElementSnapshot | null;
    readonly editor: RuntimeContractElementSnapshot | null;
    readonly scroller: RuntimeContractElementSnapshot | null;
    readonly content: RuntimeContractElementSnapshot | null;
    readonly firstLine: RuntimeContractElementSnapshot | null;
    readonly katex: RuntimeContractElementSnapshot | null;
    readonly lexical: RuntimeContractElementSnapshot | null;
  };
  readonly issues: readonly string[];
}

interface EditorDebugBridge {
  readonly ready?: Promise<void>;
  readonly getDoc?: () => string;
}

interface AppDebugBridge {
  readonly ready?: Promise<void>;
  readonly getMode?: () => EditorMode;
}

function isVisibleElement(element: RuntimeContractElementSnapshot | null): boolean {
  if (!element) return false;
  return element.rect.width > 0
    && element.rect.height > 0
    && element.style.display !== "none"
    && element.style.visibility !== "hidden"
    && element.style.opacity !== "0";
}

function elementSnapshotFromElement(
  selector: string,
  el: HTMLElement | null,
): RuntimeContractElementSnapshot | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return {
    selector,
    className: el.className,
    text: el.textContent?.slice(0, 160) ?? "",
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    },
    style: {
      backgroundColor: style.backgroundColor,
      color: style.color,
      display: style.display,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      maxWidth: style.maxWidth,
      opacity: style.opacity,
      overflow: style.overflow,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      paddingTop: style.paddingTop,
      visibility: style.visibility,
    },
  };
}

function elementSnapshot(selector: string): RuntimeContractElementSnapshot | null {
  return elementSnapshotFromElement(
    selector,
    document.querySelector<HTMLElement>(selector),
  );
}

function rootCmContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>(ROOT_CM_CONTENT_SELECTOR);
}

function countRootCmLines(): number {
  return rootCmContent()?.querySelectorAll(":scope > .cm-line").length ?? 0;
}

function countRootCmBlockWidgets(): number {
  const content = rootCmContent();
  if (!content) return 0;
  return Array.from(content.querySelectorAll(
    ".cf-table-widget, .cf-math-display, .cf-image-wrapper",
  )).filter((element) => !element.closest(".cf-table-cell-editing")).length;
}

function findKatexMainFontUrl(): string | null {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch (_error) {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue("font-family");
      const src = rule.style.getPropertyValue("src");
      if (!family.includes("KaTeX_Main") || !src.includes("Regular")) continue;
      const match = /url\(["']?([^"')]+)["']?\)/u.exec(src);
      return match?.[1] ?? null;
    }
  }
  return null;
}

async function fetchFontProbe(fontUrl: string | null): Promise<Record<string, unknown> | null> {
  if (!fontUrl) return null;
  try {
    const response = await fetch(fontUrl);
    return {
      ok: response.ok,
      status: response.status,
      type: response.type,
      url: response.url,
      contentType: response.headers.get("content-type"),
      byteLength: (await response.arrayBuffer()).byteLength,
    };
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForKatexMainFontLoaded(): Promise<boolean | null> {
  const fonts = document.fonts;
  if (!fonts?.check) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await fonts.ready.catch(() => undefined);
    if (fonts.check("16px KaTeX_Main")) return true;
    await fonts.load?.("16px KaTeX_Main").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fonts.check("16px KaTeX_Main");
}

export function evaluateEditorRuntimeContract(
  snapshot: Omit<EditorRuntimeContractSnapshot, "issues">,
): readonly string[] {
  const issues: string[] = [];
  const {
    counts,
    docLength,
    elements,
    fonts,
    mode,
  } = snapshot;

  if (!isVisibleElement(elements.app)) {
    issues.push("app root is not visible");
  }
  if (docLength === null || docLength < 0) {
    issues.push(`invalid document length: ${String(docLength)}`);
  }

  if (mode && isCm6EditorMode(mode)) {
    const isSourceMode = mode === "source";
    if (counts.cmEditor !== 1) issues.push(`expected one CM6 editor, found ${counts.cmEditor}`);
    if (counts.cmScroller !== 1) issues.push(`expected one CM6 scroller, found ${counts.cmScroller}`);
    if (counts.cmContent !== 1) issues.push(`expected one CM6 content root, found ${counts.cmContent}`);
    if (!isVisibleElement(elements.editor)) issues.push("CM6 editor is not visible");
    if (!isVisibleElement(elements.scroller)) issues.push("CM6 scroller is not visible");
    if (!isVisibleElement(elements.content)) issues.push("CM6 content is not visible");
    if (elements.editor && elements.editor.style.display !== "flex") {
      issues.push(`CM6 editor display must be flex, got ${elements.editor.style.display}`);
    }
    if (elements.scroller && elements.scroller.style.display !== "flex") {
      issues.push(`CM6 scroller display must be flex, got ${elements.scroller.style.display}`);
    }
    if (elements.content && elements.content.style.maxWidth !== "800px") {
      issues.push(`CM6 content max-width must be 800px, got ${elements.content.style.maxWidth}`);
    }
    if (
      elements.content
      && elements.content.style.maxWidth !== "800px"
      && elements.content.style.marginLeft === "0px"
    ) {
      issues.push("CM6 content must keep the shared document column left margin");
    }
    if (!isSourceMode && elements.content && !elements.content.style.fontFamily.includes("KaTeX_Main")) {
      issues.push(`CM6 content font must use KaTeX_Main, got ${elements.content.style.fontFamily}`);
    }
    if (
      docLength !== null &&
      docLength > 0 &&
      counts.cmLine === 0 &&
      counts.cmBlockWidget === 0
    ) {
      issues.push("CM6 document has no visible line nodes");
    }
    if (elements.content && elements.scroller) {
      const offset = elements.content.rect.top - elements.scroller.rect.top;
      const maxOffset = Math.max(128, elements.scroller.rect.height);
      if (offset > maxOffset) {
        issues.push(`CM6 content is displaced below viewport by ${Math.round(offset)}px`);
      }
    }
  }

  if (mode && isLexicalEditorMode(mode)) {
    if (counts.lexicalEditor < 1) issues.push("expected a Lexical editor root");
    if (!isVisibleElement(elements.lexical)) issues.push("Lexical editor is not visible");
  }

  if (counts.katex > 0) {
    if (!isVisibleElement(elements.katex)) issues.push("KaTeX output is not visible");
    if (fonts.katexMainLoaded === false) issues.push("KaTeX_Main font is not loaded");
    if (fonts.fontFetch && fonts.fontFetch.ok === false) {
      issues.push(`KaTeX font fetch failed: ${String(fonts.fontFetch.status)}`);
    }
    if (fonts.fontFetch && typeof fonts.fontFetch.error === "string") {
      issues.push(`KaTeX font fetch errored: ${fonts.fontFetch.error}`);
    }
  }

  return issues;
}

export async function collectEditorRuntimeContract(): Promise<EditorRuntimeContractSnapshot> {
  const global = window as Window & {
    __app?: AppDebugBridge;
    __editor?: EditorDebugBridge;
  };
  await global.__app?.ready?.catch(() => undefined);
  await global.__editor?.ready?.catch(() => undefined);
  const katexMainLoaded = await waitForKatexMainFontLoaded();

  const fontUrl = findKatexMainFontUrl();
  const base = {
    href: window.location.href,
    title: document.title,
    mode: global.__app?.getMode?.() ?? null,
    bodyText: document.body.textContent?.slice(0, 300) ?? "",
    docLength: global.__editor?.getDoc?.().length ?? null,
    fonts: {
      status: document.fonts?.status ?? null,
      katexMainLoaded,
      fontUrl,
      fontFetch: await fetchFontProbe(fontUrl),
    },
    counts: {
      cmEditor: document.querySelectorAll(ROOT_CM_EDITOR_SELECTOR).length,
      cmScroller: document.querySelectorAll(ROOT_CM_SCROLLER_SELECTOR).length,
      cmContent: document.querySelectorAll(ROOT_CM_CONTENT_SELECTOR).length,
      cmLine: countRootCmLines(),
      cmBlockWidget: countRootCmBlockWidgets(),
      katex: document.querySelectorAll(".katex").length,
      lexicalEditor: document.querySelectorAll(".cf-lexical-editor:not(.cf-lexical-nested-editor)").length,
    },
    elements: {
      app: elementSnapshot("#app"),
      editor: elementSnapshot(ROOT_CM_EDITOR_SELECTOR),
      scroller: elementSnapshot(ROOT_CM_SCROLLER_SELECTOR),
      content: elementSnapshot(ROOT_CM_CONTENT_SELECTOR),
      firstLine: elementSnapshotFromElement(
        `${ROOT_CM_CONTENT_SELECTOR} > .cm-line`,
        rootCmContent()?.querySelector<HTMLElement>(":scope > .cm-line") ?? null,
      ),
      katex: elementSnapshot(".katex"),
      lexical: elementSnapshot(".cf-lexical-editor:not(.cf-lexical-nested-editor)"),
    },
  } satisfies Omit<EditorRuntimeContractSnapshot, "issues">;

  return {
    ...base,
    issues: evaluateEditorRuntimeContract(base),
  };
}

export async function installTauriRenderDiagnostics(): Promise<void> {
  if (!isTauri()) return;
  try {
    if (localStorage.getItem(TAURI_RENDER_DIAGNOSTICS_KEY) !== "1") return;
  } catch (_error) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
  console.error("[tauri-render-diagnostics]", await collectEditorRuntimeContract());
}
