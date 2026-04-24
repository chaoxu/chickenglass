/**
 * Regression test: incomplete inline spans inside table cells.
 *
 * Verifies that rich table rendering survives unmatched inline delimiters
 * inside cells instead of swallowing the remaining separators on the row.
 */

/* global window */

import {
  openFile,
  switchToMode,
  waitForDebugBridge,
  waitForRenderReady,
} from "../test-helpers.mjs";

export const name = "table-inline-spans";

const cases = [
  {
    name: "unmatched-dollar",
    insertText: "$a",
    expectedFirstCell: "$a",
  },
  {
    name: "unmatched-backslash-paren",
    insertText: "\\(a",
    expectedFirstCell: "(a",
  },
  {
    name: "double-dollar-literal",
    insertText: "$$",
    expectedFirstCell: "$$",
  },
  {
    name: "unmatched-backtick",
    insertText: "`a",
    expectedFirstCell: "`a",
  },
];

const expectedSecondCell = "string";
const expectedThirdCell = "Path to CSL style file";

async function inspectCase(page, insertText) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForDebugBridge(page);
  await openFile(page, "FORMAT.md");
  await switchToMode(page, "cm6-rich");
  await waitForRenderReady(page, { selector: ".cf-table-widget" });

  return page.evaluate(({ insertText }) => {
    const view = window.__cmView;
    let targetLine = -1;
    for (let line = 1; line <= view.state.doc.lines; line += 1) {
      if (view.state.doc.line(line).text.includes("| `csl` |")) {
        targetLine = line;
        break;
      }
    }

    if (targetLine < 0) {
      return {
        foundTarget: false,
        docLine: "",
        rowSlice: [],
      };
    }

    const line = view.state.doc.line(targetLine);
    const target = "`csl`";
    const from = line.from + line.text.indexOf(target);
    const to = from + target.length;
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: 0 },
    });

    const cells = [...view.dom.querySelectorAll(".cf-table-widget th, .cf-table-widget td")]
      .map((el) => el.textContent?.trim() ?? "");
    const thirdIndex = cells.indexOf("Path to CSL style file");
    return {
      foundTarget: true,
      docLine: view.state.doc.line(targetLine).text,
      rowSlice: thirdIndex >= 2 ? cells.slice(thirdIndex - 2, thirdIndex + 1) : [],
    };
  }, { insertText });
}

export async function run(page) {
  for (const testCase of cases) {
    const result = await inspectCase(page, testCase.insertText);

    if (!result.foundTarget) {
      return {
        pass: false,
        message: `${testCase.name}: could not find the FORMAT.md csl row`,
      };
    }

    if (result.rowSlice.length !== 3) {
      return {
        pass: false,
        message: `${testCase.name}: expected a 3-cell rendered row, got ${JSON.stringify(result.rowSlice)}`,
      };
    }

    if (result.rowSlice[0] !== testCase.expectedFirstCell) {
      return {
        pass: false,
        message: `${testCase.name}: expected first rendered cell ${JSON.stringify(testCase.expectedFirstCell)}, got ${JSON.stringify(result.rowSlice[0])}`,
      };
    }

    if (result.rowSlice[1] !== expectedSecondCell) {
      return {
        pass: false,
        message: `${testCase.name}: expected second rendered cell ${JSON.stringify(expectedSecondCell)}, got ${JSON.stringify(result.rowSlice[1])}`,
      };
    }

    if (result.rowSlice[2] !== expectedThirdCell) {
      return {
        pass: false,
        message: `${testCase.name}: expected third rendered cell ${JSON.stringify(expectedThirdCell)}, got ${JSON.stringify(result.rowSlice[2])}`,
      };
    }
  }

  return {
    pass: true,
    message: `${cases.length} rich-mode table cell edits preserved the rendered row structure`,
  };
}
