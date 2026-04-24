/**
 * Regression test: rendered editor surfaces map clicks back to the source.
 *
 * Covers the drift-prone surfaces shared by CM6 rich and Lexical modes:
 * math, code, tables, fenced blocks, and images.
 */

/* global document, window */

import {
  openFixtureDocument,
  readEditorText,
  settleEditorLayout,
  switchToMode,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "rendered-hit-testing";

const IMAGE_URL =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22160%22%20height%3D%2290%22%20viewBox%3D%220%200%20160%2090%22%3E%3Crect%20width%3D%22160%22%20height%3D%2290%22%20fill%3D%22%23dbeafe%22/%3E%3Cpath%20d%3D%22M20%2070%20L70%2025%20L105%2055%20L130%2035%20L145%2070Z%22%20fill%3D%22%232563eb%22/%3E%3C/svg%3E";

const FIXTURE = {
  virtualPath: "rendered-hit-testing.md",
  displayPath: "generated:rendered-hit-testing.md",
  content: [
    "---",
    "title: Rendered Hit Testing",
    "---",
    "",
    "# Rendered Hit Testing {#sec:hit-testing}",
    "",
    "Inline surfaces include $a+b$ and ![Tiny inline pixel](" + IMAGE_URL + ") in prose.",
    "",
    "![Standalone pixel](" + IMAGE_URL + ")",
    "",
    "```ts",
    "const alpha = 1;",
    "```",
    "",
    "$$",
    "x^2 + y^2 = z^2",
    "$$ {#eq:hit-testing}",
    "",
    "| Name | Formula |",
    "| --- | --- |",
    "| Row A | $q+r$ and `cell code` |",
    "",
    '::: {.theorem #thm:hit-testing title="Hit Test Theorem"}',
    "The theorem body has $m+n$.",
    ":::",
    "",
  ].join("\n"),
};

const MODE_CASES = [
  {
    mode: "cm6-rich",
    cases: [
      {
        label: "CM6 inline math",
        selector: ".cf-math-inline .katex",
        rangeNeedle: "$a+b$",
        mutation: "bridge",
      },
      {
        label: "CM6 code block",
        selector: ".cf-codeblock-body, .cf-codeblock-last",
        text: "const alpha",
        rangeNeedle: "```ts\nconst alpha = 1;\n```\n",
        mutation: "keyboard",
      },
      {
        label: "CM6 display math",
        selector: ".cf-math-display .katex",
        rangeNeedle: "x^2 + y^2 = z^2",
        mutation: "bridge",
      },
      {
        label: "CM6 table cell",
        selector: ".cf-table-widget tbody tr:nth-child(1) td:nth-child(2)",
        rangeNeedle: "$q+r$ and `cell code`",
        mutation: "keyboard",
        requireSelectionInRange: false,
      },
      {
        label: "CM6 fenced block",
        selector: ".cf-block-theorem",
        rangeNeedle: '::: {.theorem #thm:hit-testing title="Hit Test Theorem"}\nThe theorem body has $m+n$.\n:::\n',
        mutation: "bridge",
      },
      {
        label: "CM6 standalone image",
        selector: '.cf-image-wrapper img[alt="Standalone pixel"]',
        rangeNeedle: "![Standalone pixel]",
        mutation: "bridge",
      },
    ],
  },
  {
    mode: "lexical",
    cases: [
      {
        label: "Lexical inline math",
        selector: ".cf-lexical-inline-math .katex, .cf-lexical-inline-math",
        rangeNeedle: "$a+b$",
        mutation: "bridge",
      },
      {
        label: "Lexical code block",
        selector: ".cf-lexical-code-block",
        text: "const alpha",
        rangeNeedle: "```ts\nconst alpha = 1;\n```\n",
        mutation: "keyboard",
      },
      {
        label: "Lexical display math",
        selector: ".cf-lexical-display-math-body .katex, .cf-lexical-display-math-body",
        rangeNeedle: "x^2 + y^2 = z^2",
        mutation: "keyboard",
      },
      {
        label: "Lexical table cell",
        selector: ".cf-lexical-table-block tbody tr:nth-child(2) td:nth-child(2)",
        rangeNeedle: "$q+r$ and `cell code`",
        mutation: "keyboard",
        requireSelectionInRange: false,
      },
      {
        label: "Lexical fenced block",
        selector: ".cf-lexical-block--theorem .cf-lexical-block-body",
        rangeNeedle: '::: {.theorem #thm:hit-testing title="Hit Test Theorem"}\nThe theorem body has $m+n$.\n:::\n',
        mutation: "bridge",
      },
      {
        label: "Lexical standalone image",
        selector: '.cf-lexical-image[alt="Standalone pixel"], .cf-lexical-inline-image[alt="Standalone pixel"]',
        rangeNeedle: "![Standalone pixel](" + IMAGE_URL + ")",
        inputMethod: "insertText",
        mutation: "keyboard",
      },
    ],
  },
];

function rangeForNeedle(doc, needle) {
  const from = doc.indexOf(needle);
  if (from < 0) {
    throw new Error(`Fixture is missing source needle ${JSON.stringify(needle)}.`);
  }
  return { from, to: from + needle.length };
}

async function resetFixture(page, mode) {
  await page.evaluate((doc) => {
    window.__editor.setDoc(doc);
    window.__editor.setSelection(0, 0);
  }, FIXTURE.content);
  await switchToMode(page, mode);
  await waitForRenderReady(page, { frameCount: 3, delayMs: 64 });
}

async function targetCenter(page, selector) {
  const target = typeof selector === "string" ? { selector } : selector;
  return page.evaluate(({ selector: cssSelector, text }) => {
    const visibleElements = [...document.querySelectorAll(cssSelector)]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => {
        element.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = element.getBoundingClientRect();
        return { element, rect };
      })
      .filter(({ element, rect }) =>
        rect.width > 1 &&
        rect.height > 1 &&
        (!text || (element.textContent ?? "").includes(text))
      );

    const target = visibleElements[0];
    if (!target) {
      return null;
    }

    if (text) {
      const walker = document.createTreeWalker(target.element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const value = node.textContent ?? "";
        const index = value.indexOf(text);
        if (index < 0) {
          continue;
        }
        const range = document.createRange();
        const offset = index + Math.max(1, Math.floor(text.length / 2));
        range.setStart(node, Math.max(index, offset - 1));
        range.setEnd(node, Math.min(value.length, offset + 1));
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return {
            height: rect.height,
            width: rect.width,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
      }
    }

    return {
      height: target.rect.height,
      width: target.rect.width,
      x: target.rect.left + target.rect.width / 2,
      y: target.rect.top + target.rect.height / 2,
    };
  }, target);
}

function finiteSelection(selection) {
  return selection &&
    Number.isFinite(selection.anchor) &&
    Number.isFinite(selection.focus) &&
    Number.isFinite(selection.from) &&
    Number.isFinite(selection.to);
}

function selectionIntersects(selection, range) {
  if (!finiteSelection(selection)) {
    return false;
  }
  const from = Math.min(selection.from, selection.to, selection.anchor, selection.focus);
  const to = Math.max(selection.from, selection.to, selection.anchor, selection.focus);
  return to >= range.from && from <= range.to;
}

async function clickSurface(page, testCase) {
  const marker = `HT${Math.random().toString(36).slice(2, 8)}`;
  const range = rangeForNeedle(FIXTURE.content, testCase.rangeNeedle);
  const target = await targetCenter(page, testCase);
  if (!target) {
    return `missing target for ${testCase.label}: ${testCase.selector}`;
  }

  await page.mouse.click(target.x, target.y);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 80 });

  const afterClick = await page.evaluate(() => ({
    activeTag: document.activeElement?.tagName ?? null,
    doc: window.__editor.getDoc(),
    selection: window.__editor.getSelection(),
  }));

  if (testCase.requireSelectionInRange !== false) {
    if (!selectionIntersects(afterClick.selection, range)) {
      return (
        `${testCase.label} click selected ${JSON.stringify(afterClick.selection)}, ` +
        `expected intersection with ${range.from}:${range.to}`
      );
    }
  } else if (!finiteSelection(afterClick.selection)) {
    return `${testCase.label} click did not leave a finite editor selection`;
  }

  if (testCase.mutation === "keyboard") {
    if (testCase.inputMethod === "insertText") {
      await page.keyboard.insertText(marker);
    } else {
      await page.keyboard.type(marker);
    }
  } else {
    await page.evaluate((nextMarker) => {
      window.__editor.insertText(nextMarker);
    }, marker);
  }
  await settleEditorLayout(page, { frameCount: 3, delayMs: 80 });

  const afterMutation = await readEditorText(page);
  if (afterMutation === afterClick.doc || !afterMutation.includes(marker)) {
    return `${testCase.label} click did not support document mutation via ${testCase.mutation}`;
  }

  return null;
}

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, {
    mode: "cm6-rich",
    timeoutMs: 15_000,
    settleMs: 300,
  });

  for (const modeGroup of MODE_CASES) {
    await resetFixture(page, modeGroup.mode);

    for (const testCase of modeGroup.cases) {
      await resetFixture(page, modeGroup.mode);
      const error = await clickSurface(page, testCase);
      if (error) {
        return { pass: false, message: error };
      }
    }
  }

  return {
    pass: true,
    message: "rendered CM6 and Lexical surfaces select source and accept edits",
  };
}
