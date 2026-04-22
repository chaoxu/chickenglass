/**
 * Regression test: repeated Lexical bridge inserts remain canonical after the
 * deferred rich sync window.
 */

/* global window */

import {
  openFixtureDocument,
  resolveFixtureDocument,
  sleep,
  switchToMode,
} from "../test-helpers.mjs";
import {
  availableTypingBurstCases,
  findTypingBurstPositions,
} from "../perf-regression.mjs";

export const name = "lexical-bridge-insert-burst";

const INSERT_COUNT = 100;
const TARGET_FIXTURE_KEY = "index";
const TARGET_POSITION_KEY = "after_frontmatter";

export async function run(page) {
  try {
    const fixtureCase = availableTypingBurstCases().find(
      (candidate) => candidate.key === TARGET_FIXTURE_KEY,
    );
    if (!fixtureCase) {
      throw new Error(`missing ${TARGET_FIXTURE_KEY} typing burst fixture`);
    }
    const fixture = resolveFixtureDocument(fixtureCase);
    const positions = findTypingBurstPositions(fixture.content, fixtureCase.positionKeys);
    const position = positions[TARGET_POSITION_KEY];
    if (!position) {
      throw new Error(
        `missing ${TARGET_POSITION_KEY} typing burst position in ${fixture.displayPath}`,
      );
    }

    await switchToMode(page, "source");
    await openFixtureDocument(page, fixture, {
      mode: "lexical",
      settleMs: 1_000,
      timeoutMs: 45_000,
    });

    const result = await page.evaluate(async ({ anchor, count }) => {
      const editor = window.__editor;
      await editor.ready;
      const before = editor.getDoc();
      const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForAnimationFrames = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );

      editor.setSelection(anchor, anchor);
      editor.focus();
      await waitForAnimationFrames();

      const insertText = "1".repeat(count);
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
      await sleepInPage(650);
      const after = editor.getDoc();
      return {
        afterLength: after.length,
        beforeLength: before.length,
        expectedLength,
        insertedAtAnchor: after.slice(anchor, anchor + insertText.length),
      };
    }, {
      anchor: position.anchor,
      count: INSERT_COUNT,
    });

    if (result.afterLength !== result.expectedLength) {
      return {
        pass: false,
        message: `expected Lexical bridge insert to persist length ${result.expectedLength}, got ${result.afterLength}`,
      };
    }

    if (result.insertedAtAnchor !== "1".repeat(INSERT_COUNT)) {
      return {
        pass: false,
        message: `bridge insert did not persist at requested source anchor: ${JSON.stringify(result)}`,
      };
    }

    await sleep(100);
    return {
      pass: true,
      message: `Lexical bridge burst persisted ${result.afterLength - result.beforeLength} inserted chars`,
    };
  } finally {
    await switchToMode(page, "cm6-rich");
  }
}
