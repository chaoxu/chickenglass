import {
  openFixtureDocument,
  screenshot,
  settleEditorLayout,
  switchToMode,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "visual-surface-parity";

const FIXTURE = {
  content: [
    "# Visual Parity {#sec:visual}",
    "",
    "Paragraph text keeps the document rhythm stable across editor surfaces.",
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
    "$$",
    "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
    "$$ {#eq:visual}",
    "",
    "| Symbol | Meaning |",
    "| --- | --- |",
    "| $x$ | variable |",
    "| $y$ | response |",
    "",
  ].join("\n"),
  displayPath: "fixture:visual-surface-parity.md",
  virtualPath: "visual-surface-parity.md",
};

const SURFACES = [
  {
    key: "heading",
    selector: ".cf-doc-heading--h1",
    style: ["color", "fontFamily", "fontSize", "fontStyle", "fontWeight", "lineHeight"],
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
    lexicalSelector: ".cf-lexical-block--theorem .cf-lexical-block-body",
    style: ["color", "fontFamily", "fontSize", "lineHeight"],
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
];

function clip(rect) {
  return {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  };
}

function visualSelector(mode, selector) {
  const flowClass = mode === "lexical" ? ".cf-doc-flow--lexical" : ".cf-doc-flow--cm6";
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
  const selector = visualSelector(mode, surfaceSelector(mode, surface));
  const rect = await page.evaluate(({ selector }) => {
    const element = [...document.querySelectorAll(selector)]
      .find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return candidate instanceof HTMLElement && box.width > 0 && box.height > 0;
      });
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
    return element.getBoundingClientRect().toJSON();
  }, { selector });
  if (!rect) {
    throw new Error(`Missing ${mode} visual surface ${surface.key}`);
  }

  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
  const settledRect = await page.evaluate(({ selector }) => {
    const element = [...document.querySelectorAll(selector)]
      .find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return candidate instanceof HTMLElement && box.width > 0 && box.height > 0;
      });
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    return element.getBoundingClientRect().toJSON();
  }, { selector });
  if (!settledRect) {
    throw new Error(`Missing ${mode} visual surface ${surface.key} after layout settle`);
  }

  const shot = await screenshot(page, {
    animations: "disabled",
    clip: clip(settledRect),
    fallback: false,
  });

  const metrics = await page.evaluate(({ properties, selector }) => {
    const element = [...document.querySelectorAll(selector)]
      .find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return candidate instanceof HTMLElement && box.width > 0 && box.height > 0;
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
    if (left.screenshotBytes < 500 || right.screenshotBytes < 500) {
      return `${surface.key} screenshot looks empty: CM6=${left.screenshotBytes}, Lexical=${right.screenshotBytes}`;
    }

    const widthError = assertNear(
      left.rect.width,
      right.rect.width,
      24,
      `${surface.key} visual width drift`,
    );
    if (widthError) return widthError;

    const heightTolerance = Math.max(14, Math.max(left.rect.height, right.rect.height) * 0.35);
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
  await openFixtureDocument(page, FIXTURE, {
    mode: "cm6-rich",
    project: "single-file",
  });

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
