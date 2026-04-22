import {
  openFixtureDocument,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "inline-reveal-geometry";

const DOCUMENT = `---
bibliography: reference.bib
---

# Geometry Target {#sec:geometry-target}

Anchor link [target](https://example.com/path) tail
Anchor citation [@cormen2009] tail
Anchor crossref [@sec:geometry-target] tail
Anchor math $x + y$ tail
Anchor footnote reference[^note] tail
Anchor code \`code\` tail
Anchor emphasis **bold** and *em* tail

[^note]: Anchor footnote label body
`;

const CASES = [
  {
    label: "link",
    lineNeedle: "Anchor link",
    tokenNeedle: "target",
    tokenOffset: 2,
    beforeSelector: ".cf-link-rendered",
    afterSelector: ".cf-inline-source",
  },
  {
    label: "citation",
    lineNeedle: "Anchor citation",
    tokenNeedle: "cormen2009",
    tokenOffset: 2,
    beforeSelector: ".cf-citation",
    afterSelector: ".cf-reference-source",
  },
  {
    label: "crossref",
    lineNeedle: "Anchor crossref",
    tokenNeedle: "sec:geometry-target",
    tokenOffset: 2,
    beforeSelector: ".cf-crossref",
    afterSelector: ".cf-reference-source",
  },
  {
    label: "inline math",
    lineNeedle: "Anchor math",
    tokenNeedle: "x + y",
    tokenOffset: 1,
    beforeSelector: ".cf-math-inline",
    afterSelector: ".cf-math-source",
  },
  {
    label: "footnote label",
    lineNeedle: "Anchor footnote label body",
    tokenNeedle: "[^note]",
    tokenOffset: 2,
    beforeSelector: ".cf-sidenote-def-label",
    afterSelector: ".cf-inline-source",
    activateStructure: true,
  },
  {
    label: "inline code",
    lineNeedle: "Anchor code",
    tokenNeedle: "code",
    tokenOffset: 2,
    beforeSelector: ".cf-inline-code",
    afterSelector: ".cf-inline-code",
  },
  {
    label: "emphasis markers",
    lineNeedle: "Anchor emphasis",
    tokenNeedle: "bold",
    tokenOffset: 2,
    beforeSelector: ".cf-bold",
    afterSelector: ".cf-source-delimiter",
  },
];

const GEOMETRY_TOLERANCE_PX = 1;

function formatDelta(value) {
  return value.toFixed(2);
}

async function clearRevealState(page) {
  await page.evaluate(() => {
    window.__cmDebug?.clearStructure?.();
    const view = window.__cmView;
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
  });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
}

async function ensureSidenoteLabelsVisible(page) {
  const hasDefinitionLabel = await page.evaluate(() =>
    Boolean(document.querySelector(".cf-sidenote-def-label"))
  );
  if (hasDefinitionLabel) return;

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
      candidate.getAttribute("aria-label")?.includes("Command Palette")
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("missing command palette button");
    }
    button.click();
  });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("[cmdk-item]")).some((candidate) =>
      candidate.textContent?.includes("Toggle Sidenote Margin")
    ),
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll("[cmdk-item]")).find((candidate) =>
      candidate.textContent?.includes("Toggle Sidenote Margin")
    );
    if (!(item instanceof HTMLElement)) {
      throw new Error("missing Toggle Sidenote Margin command");
    }
    item.click();
  });
  await settleEditorLayout(page, { frameCount: 4, delayMs: 100 });
}

async function measureLineGeometry(page, testCase, selector) {
  return page.evaluate(
    ({ lineNeedle, requiredSelector }) => {
      const view = window.__cmView;
      if (!view) {
        throw new Error("window.__cmView is unavailable");
      }

      const line = Array.from({ length: view.state.doc.lines }, (_, index) =>
        view.state.doc.line(index + 1)
      ).find((candidate) => candidate.text.includes(lineNeedle));
      if (!line) {
        throw new Error(`missing line containing ${JSON.stringify(lineNeedle)}`);
      }

      const anchorIndex = line.text.indexOf("Anchor");
      if (anchorIndex < 0) {
        throw new Error(`missing Anchor sentinel on ${JSON.stringify(line.text)}`);
      }

      const anchorPos = line.from + anchorIndex;
      const domAt = view.domAtPos(anchorPos);
      const parent = domAt.node instanceof HTMLElement
        ? domAt.node
        : domAt.node.parentElement;
      const lineEl = parent?.closest(".cm-line");
      if (!(lineEl instanceof HTMLElement)) {
        throw new Error(`missing DOM line for ${JSON.stringify(lineNeedle)}`);
      }

      const tokenEl = requiredSelector
        ? lineEl.querySelector(requiredSelector)
        : null;
      if (requiredSelector && !(tokenEl instanceof HTMLElement)) {
        throw new Error(
          `missing ${requiredSelector} on line ${JSON.stringify(lineNeedle)}; ` +
            `text=${JSON.stringify(lineEl.textContent ?? "")}`,
        );
      }

      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
      let anchorText = null;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node instanceof Text && node.textContent?.includes("Anchor")) {
          anchorText = node;
          break;
        }
      }
      if (!anchorText?.textContent) {
        throw new Error(`missing Anchor text node on ${JSON.stringify(lineNeedle)}`);
      }

      const start = anchorText.textContent.indexOf("Anchor");
      const range = document.createRange();
      range.setStart(anchorText, start);
      range.setEnd(anchorText, start + "Anchor".length);
      const anchorRect = range.getBoundingClientRect();
      range.detach();
      const lineRect = lineEl.getBoundingClientRect();

      return {
        line: line.number,
        lineRect: {
          top: lineRect.top,
          bottom: lineRect.bottom,
          height: lineRect.height,
        },
        anchorRect: {
          top: anchorRect.top,
          bottom: anchorRect.bottom,
          height: anchorRect.height,
        },
      };
    },
    {
      lineNeedle: testCase.lineNeedle,
      requiredSelector: selector,
    },
  );
}

async function revealCase(page, testCase) {
  await page.evaluate(
    ({ lineNeedle, tokenNeedle, tokenOffset, activateStructure }) => {
      const view = window.__cmView;
      if (!view) {
        throw new Error("window.__cmView is unavailable");
      }
      const line = Array.from({ length: view.state.doc.lines }, (_, index) =>
        view.state.doc.line(index + 1)
      ).find((candidate) => candidate.text.includes(lineNeedle));
      if (!line) {
        throw new Error(`missing line containing ${JSON.stringify(lineNeedle)}`);
      }

      const tokenIndex = line.text.indexOf(tokenNeedle);
      if (tokenIndex < 0) {
        throw new Error(
          `missing token ${JSON.stringify(tokenNeedle)} on ${JSON.stringify(line.text)}`,
        );
      }

      view.focus();
      view.dispatch({
        selection: {
          anchor: line.from + tokenIndex + tokenOffset,
        },
      });
      if (activateStructure) {
        window.__cmDebug?.activateStructureAtCursor?.();
      }
    },
    testCase,
  );
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
}

function assertStableGeometry(testCase, before, after) {
  const lineHeightDelta = after.lineRect.height - before.lineRect.height;
  const anchorTopDelta = Math.abs(after.anchorRect.top - before.anchorRect.top);
  const anchorBottomDelta = Math.abs(after.anchorRect.bottom - before.anchorRect.bottom);
  const anchorHeightDelta = Math.abs(after.anchorRect.height - before.anchorRect.height);

  if (lineHeightDelta > GEOMETRY_TOLERANCE_PX) {
    return (
      `${testCase.label} reveal increased line height by ${formatDelta(lineHeightDelta)}px ` +
      `(before=${formatDelta(before.lineRect.height)}, after=${formatDelta(after.lineRect.height)})`
    );
  }

  if (
    anchorTopDelta > GEOMETRY_TOLERANCE_PX ||
    anchorBottomDelta > GEOMETRY_TOLERANCE_PX ||
    anchorHeightDelta > GEOMETRY_TOLERANCE_PX
  ) {
    return (
      `${testCase.label} reveal shifted Anchor geometry ` +
      `(top=${formatDelta(anchorTopDelta)}, bottom=${formatDelta(anchorBottomDelta)}, ` +
      `height=${formatDelta(anchorHeightDelta)})`
    );
  }

  return null;
}

export async function run(page) {
  await openFixtureDocument(
    page,
    {
      virtualPath: "inline-reveal-geometry.md",
      displayPath: "fixture:inline-reveal-geometry.md",
      content: DOCUMENT,
    },
    { mode: "cm6-rich" },
  );
  await settleEditorLayout(page, { frameCount: 4, delayMs: 100 });
  await ensureSidenoteLabelsVisible(page);

  const initialSelectors = [
    ".cf-link-rendered",
    ".cf-citation",
    ".cf-crossref",
    ".cf-math-inline",
    ".cf-sidenote-def-label",
    ".cf-inline-code",
    ".cf-bold",
  ];
  try {
    await page.waitForFunction(
      (selectors) => selectors.every((selector) => document.querySelector(selector)),
      initialSelectors,
      { timeout: 5000 },
    );
  } catch (error) {
    const renderedState = await page.evaluate((selectors) => ({
      selectors: Object.fromEntries(
        selectors.map((selector) => [selector, document.querySelectorAll(selector).length]),
      ),
      text: document.querySelector(".cm-content")?.textContent ?? "",
    }), initialSelectors);
    return {
      pass: false,
      message:
        `initial inline render state was incomplete: ${JSON.stringify(renderedState.selectors)}; ` +
        `wait=${error instanceof Error ? error.message : String(error)}`,
    };
  }

  for (const testCase of CASES) {
    await clearRevealState(page);
    const before = await measureLineGeometry(page, testCase, testCase.beforeSelector);
    await revealCase(page, testCase);
    const after = await measureLineGeometry(page, testCase, testCase.afterSelector);
    const error = assertStableGeometry(testCase, before, after);
    if (error) {
      return { pass: false, message: error };
    }
  }

  return {
    pass: true,
    message:
      "inline source reveal preserved line height and Anchor geometry for links, refs, math, footnotes, code, and emphasis",
  };
}
