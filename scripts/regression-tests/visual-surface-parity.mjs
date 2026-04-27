import {
  screenshot,
  settleEditorLayout,
  switchToMode,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "visual-surface-parity";

const VISUAL_DOC_PATH = "surface-parity/visual-surface.md";
const BIB_PATH = "surface-parity/references.bib";
const BIB_CONTENT = [
  "@book{knuth1984,",
  "  author = {Knuth, Donald E.},",
  "  title = {The TeXbook},",
  "  year = {1984},",
  "  publisher = {Addison-Wesley}",
  "}",
].join("\n");
const VISUAL_DOC = [
  "---",
  "title: Visual Surface Parity",
  "bibliography: references.bib",
  "blocks:",
  "  callout:",
  "    title: Callout",
  "    numbered: false",
  "---",
  "",
  "# Visual Parity {#sec:visual}",
  "",
  "Paragraph text keeps the document rhythm stable across editor surfaces. A citation [@knuth1984] and a footnote[^note] stay inline.",
  "",
  "- First item with **bold text**.",
  "- Second item with $x+y$ inline math.",
  "",
  "1. Ordered first",
  "2. Ordered second with `code`.",
  "",
  '::: {.theorem #thm:visual title="Visual Theorem"}',
  "A theorem body has $a^2+b^2=c^2$ and a short sentence.",
  ":::",
  "",
  '::: {.definition #def:visual title="Visual Definition"}',
  "A definition body keeps normal text style while using the shared block frame.",
  ":::",
  "",
  "::: {.proof}",
  "A proof body keeps normal text style and ends with the proof marker.",
  "A second proof body line gives parity tests a clean non-header line.",
  ":::",
  "",
  '::: {.callout title="Author Note"}',
  "A custom callout is currently a generic fenced block, not a first-class admonition.",
  ":::",
  "",
  "$$",
  "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
  "$$ {#eq:visual}",
  "",
  "See [@thm:visual] and [@def:visual] for local references.",
  "",
  "| Symbol | Meaning |",
  "| --- | --- |",
  "| $x$ | variable |",
  "| $y$ | response |",
  "",
  "[^note]: Footnote body with $z$ and short prose.",
].join("\n");

const SURFACES = [
  {
    key: "heading",
    selector: ".cf-doc-heading--h1",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight"],
  },
  {
    key: "paragraph",
    cm6Selector: ".cm-line[data-tag-name='p']",
    lexicalSelector: ".cf-doc-paragraph",
    minScreenshotBytes: 120,
    textIncludes: "Paragraph text",
    style: ["color", "fontFamily", "fontSize", "lineHeight", "marginTop", "marginBottom"],
  },
  {
    key: "unordered-list-item",
    cm6Selector: ".cm-line:has(.cf-list-bullet)",
    lexicalSelector: ".cf-doc-list--unordered > .cf-doc-list-item",
    style: ["color", "fontFamily", "fontSize", "lineHeight"],
  },
  {
    key: "theorem-header",
    cm6Selector: ".cm-line.cf-block-theorem.cf-block-header",
    lexicalSelector: ".cf-lexical-block--theorem .cf-lexical-block-header",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight"],
  },
  {
    key: "theorem-body",
    cm6Selector: ".cm-line.cf-block-theorem:not(.cf-block-header):not(.cf-block-closing-fence)",
    lexicalSelector: ".cf-lexical-block--theorem .cf-lexical-block-body .cf-doc-paragraph",
    style: ["color", "fontFamily", "fontSize", "lineHeight"],
  },
  {
    key: "definition-header",
    cm6Selector: ".cm-line.cf-block-definition.cf-block-header",
    lexicalSelector: ".cf-lexical-block--definition .cf-lexical-block-header",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight"],
  },
  {
    key: "definition-body",
    cm6Selector: ".cm-line.cf-block-definition:not(.cf-block-header):not(.cf-block-closing-fence)",
    lexicalSelector: ".cf-lexical-block--definition .cf-lexical-block-body .cf-doc-paragraph",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "lineHeight"],
  },
  {
    key: "proof-header",
    cm6Selector: ".cm-line.cf-block-proof.cf-block-header",
    lexicalSelector: ".cf-lexical-block--proof .cf-lexical-block-header",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight"],
  },
  {
    key: "proof-body",
    cm6Selector: ".cm-line.cf-block-proof:not(.cf-block-header):not(.cf-block-closing-fence)",
    lexicalSelector: ".cf-lexical-block--proof .cf-lexical-block-body .cf-doc-paragraph",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "lineHeight"],
  },
  {
    key: "custom-callout-header",
    cm6Selector: ".cm-line.cf-block-callout.cf-block-header",
    lexicalSelector: ".cf-lexical-block--callout .cf-lexical-block-header",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight"],
  },
  {
    key: "citation",
    cm6Selector: ".cf-citation[data-reference-widget='true']",
    lexicalSelector: ".cf-lexical-reference.cf-citation[data-coflat-citation='true']",
    minScreenshotBytes: 120,
    style: ["color", "fontFamily", "fontSize", "lineHeight"],
  },
  {
    key: "cross-reference",
    cm6Selector: ".cf-crossref[data-reference-widget='true']",
    lexicalSelector: ".cf-lexical-reference.cf-crossref[data-coflat-reference='true']",
    minScreenshotBytes: 120,
    style: ["color", "fontFamily", "fontSize", "lineHeight", "textDecorationLine", "textDecorationStyle"],
  },
  {
    key: "footnote-reference",
    cm6Selector: ".cf-sidenote-ref[data-footnote-id]",
    lexicalSelector: ".cf-lexical-footnote-ref[data-footnote-id]",
    minScreenshotBytes: 80,
    style: ["color", "fontSize", "fontWeight", "lineHeight", "verticalAlign"],
  },
  {
    key: "display-math",
    selector: ".cf-doc-display-math",
    style: ["color", "fontFamily", "fontSize"],
  },
  {
    key: "table",
    cm6Selector: ".cf-table-widget table",
    lexicalSelector: "table.cf-lexical-table-block",
    style: ["color", "fontFamily", "fontSize", "lineHeight"],
  },
  {
    key: "bibliography-entry",
    cm6Scope: "surface",
    lexicalScope: "surface",
    selector: ".cf-bibliography-entry",
    textIncludes: "Knuth",
    style: ["color", "fontFamily", "fontSize", "lineHeight", "marginTop", "marginBottom"],
  },
];

function clip(rect) {
  return {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  };
}

function visualSelector(mode, selector, surface) {
  const useSurfaceScope = mode === "lexical"
    ? surface.lexicalScope === "surface"
    : surface.cm6Scope === "surface";
  const flowClass = mode === "lexical"
    ? useSurfaceScope ? ".cf-doc-surface--lexical" : ".cf-doc-flow--lexical"
    : useSurfaceScope ? ".cf-doc-surface--cm6" : ".cf-doc-flow--cm6";
  return `${flowClass} ${selector}`;
}

function surfaceSelector(mode, surface) {
  if (mode === "lexical" && surface.lexicalSelector) {
    return surface.lexicalSelector;
  }
  if (mode !== "lexical" && surface.cm6Selector) {
    return surface.cm6Selector;
  }
  return surface.selector;
}

async function captureSurface(page, mode, surface) {
  const selector = visualSelector(mode, surfaceSelector(mode, surface), surface);
  try {
    await page.waitForFunction(
      ({ selector, textIncludes }) => {
        const element = [...document.querySelectorAll(selector)]
          .find((candidate) => {
            const box = candidate.getBoundingClientRect();
            return candidate instanceof HTMLElement &&
              box.width > 0 &&
              box.height > 0 &&
              (!textIncludes || (candidate.textContent ?? "").includes(textIncludes));
          });
        return Boolean(element);
      },
      { selector, textIncludes: surface.textIncludes },
      { timeout: 10_000, polling: 100 },
    );
  } catch (error) {
    throw new Error(
      `Timed out waiting for ${mode} visual surface ${surface.key} (${selector}): ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const rect = await page.evaluate(({ selector, textIncludes }) => {
    const element = [...document.querySelectorAll(selector)]
      .find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return candidate instanceof HTMLElement &&
          box.width > 0 &&
          box.height > 0 &&
          (!textIncludes || (candidate.textContent ?? "").includes(textIncludes));
      });
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
    return element.getBoundingClientRect().toJSON();
  }, { selector, textIncludes: surface.textIncludes });
  if (!rect) {
    throw new Error(`Missing ${mode} visual surface ${surface.key}`);
  }

  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
  const settledRect = await page.evaluate(({ selector, textIncludes }) => {
    const element = [...document.querySelectorAll(selector)]
      .find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return candidate instanceof HTMLElement &&
          box.width > 0 &&
          box.height > 0 &&
          (!textIncludes || (candidate.textContent ?? "").includes(textIncludes));
      });
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    return element.getBoundingClientRect().toJSON();
  }, { selector, textIncludes: surface.textIncludes });
  if (!settledRect) {
    throw new Error(`Missing ${mode} visual surface ${surface.key} after layout settle`);
  }

  const shot = await screenshot(page, {
    animations: "disabled",
    clip: clip(settledRect),
    fallback: false,
  });

  const metrics = await page.evaluate(({ properties, selector, textIncludes }) => {
    const element = [...document.querySelectorAll(selector)]
      .find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return candidate instanceof HTMLElement &&
          box.width > 0 &&
          box.height > 0 &&
          (!textIncludes || (candidate.textContent ?? "").includes(textIncludes));
      });
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      rect: {
        height: rect.height,
        width: rect.width,
      },
      style: Object.fromEntries(properties.map((property) => [property, style[property]])),
      text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "",
    };
  }, {
    properties: surface.style,
    selector,
    textIncludes: surface.textIncludes,
  });

  if (!metrics) {
    throw new Error(`Missing ${mode} metrics for ${surface.key}`);
  }

  return {
    ...metrics,
    screenshotBytes: shot.length,
  };
}

async function collectVisuals(page, mode) {
  await switchToMode(page, mode);
  await waitForRenderReady(page, {
    selector: mode === "lexical" ? ".cf-doc-flow--lexical .cf-doc-table-block" : ".cf-doc-flow--cm6 .cf-doc-table-block",
    frameCount: 3,
    delayMs: 64,
  });

  const result = {};
  for (const surface of SURFACES) {
    result[surface.key] = await captureSurface(page, mode, surface);
  }
  return result;
}

async function openVisualSurfaceProject(page) {
  await page.evaluate(async ({ bibContent, bibPath, docContent, docPath }) => {
    const app = window.__app;
    if (!app?.loadFixtureProject) {
      throw new Error("window.__app.loadFixtureProject is unavailable.");
    }
    await app.loadFixtureProject([
      { path: docPath, kind: "text", content: docContent },
      { path: bibPath, kind: "text", content: bibContent },
    ], docPath);
  }, {
    bibContent: BIB_CONTENT,
    bibPath: BIB_PATH,
    docContent: VISUAL_DOC,
    docPath: VISUAL_DOC_PATH,
  });
  await switchToMode(page, "cm6-rich");
  await page.waitForFunction(
    ({ docContent, docPath }) => {
      const currentPath = window.__app?.getCurrentDocument?.()?.path ?? null;
      const doc = window.__editor?.getDoc?.() ?? "";
      return currentPath === docPath && doc === docContent;
    },
    { docContent: VISUAL_DOC, docPath: VISUAL_DOC_PATH },
    { timeout: 10_000, polling: 100 },
  );
  await waitForRenderReady(page, { frameCount: 3, delayMs: 64, timeoutMs: 10_000 });
}

function assertEqual(left, right, message) {
  if (left === right) return null;
  return `${message}: CM6=${JSON.stringify(left)}, Lexical=${JSON.stringify(right)}`;
}

function assertNear(left, right, tolerance, message) {
  if (Math.abs(left - right) <= tolerance) return null;
  return `${message}: CM6=${left}, Lexical=${right}, tolerance=${tolerance}`;
}

function assertSurfaceParity(cm6, lexical) {
  for (const surface of SURFACES) {
    const left = cm6[surface.key];
    const right = lexical[surface.key];
    if (!left || !right) {
      return `Missing surface ${surface.key}`;
    }
    const minScreenshotBytes = surface.minScreenshotBytes ?? 500;
    if (left.screenshotBytes < minScreenshotBytes || right.screenshotBytes < minScreenshotBytes) {
      return `${surface.key} screenshot looks empty: CM6=${left.screenshotBytes}, Lexical=${right.screenshotBytes}`;
    }

    const widthError = assertNear(
      left.rect.width,
      right.rect.width,
      12,
      `${surface.key} visual width drift`,
    );
    if (widthError) return widthError;

    const heightTolerance = Math.max(8, Math.max(left.rect.height, right.rect.height) * 0.05);
    const heightError = assertNear(
      left.rect.height,
      right.rect.height,
      heightTolerance,
      `${surface.key} visual height drift`,
    );
    if (heightError) return heightError;

    for (const property of surface.style) {
      const styleError = assertEqual(
        left.style[property],
        right.style[property],
        `${surface.key} ${property} drift`,
      );
      if (styleError) return styleError;
    }
  }
  return null;
}

export async function run(page) {
  await openVisualSurfaceProject(page);

  const cm6 = await collectVisuals(page, "cm6-rich");
  const lexical = await collectVisuals(page, "lexical");
  const error = assertSurfaceParity(cm6, lexical);
  if (error) {
    return { pass: false, message: error };
  }

  return {
    pass: true,
    message: `${SURFACES.length} shared surfaces captured and visually aligned`,
  };
}
