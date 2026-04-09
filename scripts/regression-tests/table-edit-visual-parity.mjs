import {
  openRegressionDocument,
  scrollToText,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "table-edit-visual-parity";

function clip(rect) {
  return {
    x: Math.floor(rect.x),
    y: Math.floor(rect.y),
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  };
}

async function clearTableEditing(page) {
  await page.evaluate(() => {
    window.__cmView?.focus();
  }).catch(() => {});
  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
  await page.keyboard.press("Escape").catch(() => {});
  await settleEditorLayout(page, { frameCount: 2, delayMs: 32 });
}

async function getTokenTarget(page, rowLabel, selector) {
  return page.evaluate(
    ({ rowLabel: label, selector: tokenSelector }) => {
      const row = Array.from(document.querySelectorAll(".cf-table-widget tbody tr")).find((tr) =>
        tr.textContent?.includes(label),
      );
      if (!(row instanceof HTMLTableRowElement)) return null;
      const contentCell = row.querySelectorAll("td")[1];
      if (!(contentCell instanceof HTMLElement)) return null;
      const token = contentCell.querySelector(tokenSelector);
      if (!(token instanceof HTMLElement)) return null;
      const rect = token.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    },
    { rowLabel, selector },
  );
}

async function getPlainTextTarget(page, rowLabel) {
  return page.evaluate((label) => {
    const row = Array.from(document.querySelectorAll(".cf-table-widget tbody tr")).find((tr) =>
      tr.textContent?.includes(label),
    );
    if (!(row instanceof HTMLTableRowElement)) return null;
    const contentCell = row.querySelectorAll("td")[1];
    if (!(contentCell instanceof HTMLElement)) return null;
    const walker = document.createTreeWalker(contentCell, NodeFilter.SHOW_TEXT);
    let textNode = null;
    while (walker.nextNode()) {
      if (walker.currentNode instanceof Text && walker.currentNode.textContent?.includes(" and ")) {
        textNode = walker.currentNode;
        break;
      }
    }
    if (!(textNode instanceof Text)) return null;
    const start = textNode.textContent.indexOf(" and ");
    if (start < 0) return null;
    const range = document.createRange();
    range.setStart(textNode, start + 1);
    range.setEnd(textNode, start + 4);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, rowLabel);
}

async function capturePreviewTokenShot(page, rowLabel, selector) {
  const rect = await page.evaluate(
    ({ rowLabel: label, selector: tokenSelector }) => {
      const row = Array.from(document.querySelectorAll(".cf-table-widget tbody tr")).find((tr) =>
        tr.textContent?.includes(label),
      );
      if (!(row instanceof HTMLTableRowElement)) return null;
      const contentCell = row.querySelectorAll("td")[1];
      if (!(contentCell instanceof HTMLElement)) return null;
      const token = contentCell.querySelector(tokenSelector);
      if (!(token instanceof HTMLElement)) return null;
      return token.getBoundingClientRect().toJSON();
    },
    { rowLabel, selector },
  );
  if (!rect) return null;
  return page.screenshot({ clip: clip(rect) });
}

async function captureActiveTokenShot(page, rowLabel, selector) {
  const rect = await page.evaluate(
    ({ rowLabel: label, selector: tokenSelector }) => {
      const row = Array.from(document.querySelectorAll(".cf-table-widget tbody tr")).find((tr) =>
        tr.textContent?.includes(label),
      );
      if (!(row instanceof HTMLTableRowElement)) return null;
      const contentCell = row.querySelectorAll("td")[1];
      if (!(contentCell instanceof HTMLElement) || !contentCell.classList.contains("cf-table-cell-editing")) {
        return null;
      }
      const token = contentCell.querySelector(tokenSelector);
      if (!(token instanceof HTMLElement)) return null;
      return token.getBoundingClientRect().toJSON();
    },
    { rowLabel, selector },
  );
  if (!rect) return null;
  return page.screenshot({ clip: clip(rect) });
}

async function checkFirstRichClickStaysPreview(page, rowLabel, selector) {
  const target = await getTokenTarget(page, rowLabel, selector);
  if (!target) {
    return `missing first-click target for ${rowLabel} ${selector}`;
  }

  await page.mouse.click(target.x, target.y);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const state = await page.evaluate((tokenSelector) => ({
    activeCellCount: document.querySelectorAll(".cf-table-cell-active").length,
    editingCellCount: document.querySelectorAll(".cf-table-cell-editing").length,
    hasToken: Boolean(document.querySelector(`.cf-table-cell-active ${tokenSelector}`)),
  }), selector);

  if (
    state.activeCellCount !== 1 ||
    state.editingCellCount !== 0 ||
    !state.hasToken
  ) {
    return (
      `first rich click changed rendering for ${rowLabel} ${selector} ` +
      `(active=${state.activeCellCount}, editing=${state.editingCellCount}, token=${state.hasToken})`
    );
  }

  return null;
}

async function checkRowTokenParity(page, rowLabel, tokens) {
  await clearTableEditing(page);
  const target = await getPlainTextTarget(page, rowLabel);
  if (!target) {
    return `missing plain-text target for ${rowLabel}`;
  }

  const beforeShots = [];
  for (const token of tokens) {
    const shot = await capturePreviewTokenShot(page, rowLabel, token.before);
    if (!shot) {
      return `missing preview token ${token.before} for ${rowLabel}`;
    }
    beforeShots.push({ token, shot });
  }

  await page.mouse.click(target.x, target.y);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  for (const { token, shot } of beforeShots) {
    const afterShot = await captureActiveTokenShot(page, rowLabel, token.after);
    if (!afterShot) {
      return `missing active token ${token.after} for ${rowLabel}`;
    }
    if (!shot.equals(afterShot)) {
      return `pixel mismatch for ${rowLabel} token ${token.name}`;
    }
  }

  return null;
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await scrollToText(page, "Rich table for edit/display parity");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const firstClickChecks = [
    { rowLabel: "Quicksort", selector: ".katex" },
    { rowLabel: "Mergesort", selector: ".katex" },
    { rowLabel: "emphasis + math", selector: ".katex" },
    { rowLabel: "code + link", selector: ".cf-inline-code" },
    { rowLabel: "code + link", selector: ".cf-link-rendered" },
    { rowLabel: "citation + highlight", selector: ".cf-citation" },
    { rowLabel: "citation + highlight", selector: ".cf-highlight" },
  ];

  for (const check of firstClickChecks) {
    const error = await checkFirstRichClickStaysPreview(
      page,
      check.rowLabel,
      check.selector,
    );
    if (error) {
      return { pass: false, message: error };
    }
    await clearTableEditing(page);
  }

  const pureMathTarget = await getTokenTarget(page, "Quicksort", ".katex");
  if (!pureMathTarget) {
    return {
      pass: false,
      message: "failed to locate pure math table cell target",
    };
  }

  await page.mouse.click(pureMathTarget.x, pureMathTarget.y);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  await page.mouse.click(pureMathTarget.x, pureMathTarget.y);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const secondClickState = await page.evaluate(() => ({
    editingCellCount: document.querySelectorAll(".cf-table-cell-editing").length,
    delimiterCount:
      document.querySelector(".cf-table-cell-editing .cm-line")?.querySelectorAll(
        ".cf-source-delimiter",
      ).length ?? 0,
  }));

  if (secondClickState.editingCellCount !== 1 || secondClickState.delimiterCount === 0) {
    return {
      pass: false,
      message:
        `pure math cell second click did not enter explicit edit ` +
        `(editing=${secondClickState.editingCellCount}, delimiters=${secondClickState.delimiterCount})`,
    };
  }

  await clearTableEditing(page);

  const parityChecks = [
    {
      rowLabel: "emphasis + math",
      tokens: [
        { name: "bold", before: ".cf-bold", after: ".cf-bold" },
        { name: "math", before: ".cf-math-inline .katex", after: ".cf-math-inline .katex" },
      ],
    },
    {
      rowLabel: "code + link",
      tokens: [
        { name: "code", before: ".cf-inline-code", after: ".cf-inline-code" },
        { name: "link", before: ".cf-link-rendered", after: ".cf-link-rendered" },
      ],
    },
    {
      rowLabel: "citation + highlight",
      tokens: [
        { name: "citation", before: ".cf-citation", after: ".cf-citation" },
        { name: "highlight", before: ".cf-highlight", after: ".cf-highlight" },
      ],
    },
  ];

  for (const check of parityChecks) {
    const error = await checkRowTokenParity(page, check.rowLabel, check.tokens);
    if (error) {
      return { pass: false, message: error };
    }
  }

  await scrollToText(page, "Feature coverage matrix");
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  const featureMatrixFirstClickChecks = [
    { rowLabel: "caption stays below the media", selector: ".cf-crossref" },
    { rowLabel: "numbered block cross-reference", selector: ".cf-crossref" },
    { rowLabel: "CSL-formatted citation rendering", selector: ".cf-citation" },
    { rowLabel: "KaTeX inside table cells", selector: ".katex" },
    { rowLabel: "monospace styling inside table cells", selector: ".cf-inline-code" },
  ];

  for (const check of featureMatrixFirstClickChecks) {
    const error = await checkFirstRichClickStaysPreview(
      page,
      check.rowLabel,
      check.selector,
    );
    if (error) {
      return { pass: false, message: error };
    }
    await clearTableEditing(page);
  }

  return {
    pass: true,
    message:
      "table preview/edit rich tokens stay pixel-identical on parity rows and first-click preview stays stable across index tables",
  };
}
