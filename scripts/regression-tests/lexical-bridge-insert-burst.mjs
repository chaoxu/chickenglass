/**
 * Regression test: repeated Lexical bridge inserts remain canonical after the
 * deferred rich sync window.
 */

/* global window */

import {
  openFixtureDocument,
  readEditorText,
  resolveFixtureDocument,
  switchToMode,
  waitForDocumentStable,
} from "../test-helpers.mjs";
import {
  availableTypingBurstCases,
  findTypingBurstPositions,
} from "../perf-regression.mjs";

export const name = "lexical-bridge-insert-burst";

const INSERT_COUNT = 100;
const TARGET_FIXTURE_KEY = "index";
const TARGET_POSITION_KEY = "after_frontmatter";
const INSERT_TEXT = "COFLATLEXICALBRIDGEINSERTBURST".repeat(4).slice(0, INSERT_COUNT);

export async function run(page) {
  try {
    const fixtureCase = availableTypingBurstCases().find(
      (candidate) => candidate.key === TARGET_FIXTURE_KEY,
    );
    if (!fixtureCase) {
      throw new Error(`missing ${TARGET_FIXTURE_KEY} typing burst fixture`);
    }
    const fixture = resolveFixtureDocument(fixtureCase);
    await switchToMode(page, "source");
    await openFixtureDocument(page, fixture, {
      mode: "lexical",
      settleMs: 1_000,
      timeoutMs: 45_000,
    });
    const loadedMarkdown = await readEditorText(page);
    const positions = findTypingBurstPositions(loadedMarkdown, fixtureCase.positionKeys);
    const position = positions[TARGET_POSITION_KEY];
    if (!position) {
      throw new Error(
        `missing ${TARGET_POSITION_KEY} typing burst position in loaded ${fixture.displayPath}`,
      );
    }

    const result = await page.evaluate(async ({ anchor, count, expectedText }) => {
      const editor = window.__editor;
      await editor.ready;
      const before = editor.getDoc();
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForAnimationFrames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );

      editor.setSelection(anchor, anchor);
      const selectionAfterSet = editor.getSelection();
      editor.focus();
      await waitForAnimationFrames();
      const selectionBeforeInsert = editor.getSelection();

      const insertText = expectedText.slice(0, count);
      for (const char of insertText) {
        editor.insertText(char);
      }

      const expectedLength = before.length + insertText.length;
      const canonicalStart = performance.now();
      while (performance.now() - canonicalStart < 5_000) {
        if (editor.getDoc().length >= expectedLength) {
          break;
        }
        await sleepInPage(0);
      }
      // The Lexical bridge has a delayed rich-sync pass; this fixed observation
      // window is the regression condition, not a generic harness settle.
      await sleepInPage(1_050);
      const after = editor.getDoc();
      return {
        afterLength: after.length,
        beforeLength: before.length,
        expectedLength,
        insertIndex: after.indexOf(insertText),
        insertedText: insertText,
        insertedAtAnchor: after.slice(anchor, anchor + insertText.length),
        selectionAfterSet,
        selectionBeforeInsert,
      };
    }, {
      anchor: position.anchor,
      count: INSERT_COUNT,
      expectedText: INSERT_TEXT,
    });

    if (result.afterLength !== result.expectedLength) {
      return {
        pass: false,
        message: `expected Lexical bridge insert to persist length ${result.expectedLength}, got ${result.afterLength}`,
      };
    }

    if (result.insertedAtAnchor !== result.insertedText) {
      return {
        pass: false,
        message: `bridge insert did not persist at resolved canonical anchor: ${JSON.stringify(result)}`,
      };
    }

    await waitForDocumentStable(page, { quietMs: 100, timeoutMs: 2_000 });
    return {
      pass: true,
      message: `Lexical bridge burst persisted ${result.afterLength - result.beforeLength} inserted chars`,
    };
  } finally {
    await switchToMode(page, "cm6-rich");
  }
}
