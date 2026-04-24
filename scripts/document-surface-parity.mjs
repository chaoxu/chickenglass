#!/usr/bin/env node

import console from "node:console";
import process from "node:process";
import { closeBrowserSession, openBrowserSession } from "./devx-browser-session.mjs";
import {
  openFixtureDocument,
  settleEditorLayout,
  switchToMode,
} from "./test-helpers.mjs";

const PARITY_FIXTURE = {
  content: [
    "# Surface Parity",
    "",
    "A paragraph with **bold**, *italic*, `code`, ==highlight==, $x^2$, and [a link](https://example.com).",
    "",
    "::: {.theorem #thm:surface title=\"Shared Surface\"}",
    "A theorem body should land on the same visual rhythm.",
    ":::",
    "",
    "$$",
    "x^2 + y^2 = z^2",
    "$$ {#eq:surface}",
    "",
    "| A | B |",
    "| --- | --- |",
    "| one | two |",
    "",
  ].join("\n"),
  displayPath: "fixture:document-surface-parity.md",
  virtualPath: "document-surface-parity.md",
};

const TYPING_ANCHOR = "A paragraph with";
const TYPING_INSERT = "12345678901234567890";

function assertCondition(condition, message, details = undefined) {
  if (condition) {
    return;
  }
  const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
  throw new Error(`${message}${suffix}`);
}

function assertStyleEqual(section, property, left, right) {
  assertCondition(
    left?.style?.[property] === right?.style?.[property],
    `${section} ${property} drifted between CM6 rich and Lexical`,
    {
      cm6: left?.style?.[property] ?? null,
      lexical: right?.style?.[property] ?? null,
    },
  );
}

function assertNear(section, property, left, right, tolerance) {
  const leftValue = left?.rect?.[property];
  const rightValue = right?.rect?.[property];
  assertCondition(
    typeof leftValue === "number" &&
      typeof rightValue === "number" &&
      Math.abs(leftValue - rightValue) <= tolerance,
    `${section} ${property} drifted by more than ${tolerance}px`,
    { cm6: left ?? null, lexical: right ?? null },
  );
}

async function waitForSurface(page, mode) {
  await page.waitForFunction((expectedMode) => {
    const surfaceSelector = expectedMode === "lexical"
      ? ".cf-doc-surface--lexical"
      : ".cf-doc-surface--cm6";
    const flowSelector = expectedMode === "lexical"
      ? ".cf-doc-flow--lexical"
      : ".cf-doc-flow--cm6";
    return Boolean(
      document.querySelector(surfaceSelector) &&
        document.querySelector(flowSelector) &&
        document.querySelector(".cf-doc-heading--h1"),
    );
  }, mode, { timeout: 10_000 });
}

async function collectSurfaceMetrics(page, mode) {
  await switchToMode(page, mode);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  await waitForSurface(page, mode);

  return page.evaluate((expectedMode) => {
    const selectorForMode = (cm6Selector, lexicalSelector) =>
      expectedMode === "lexical" ? lexicalSelector : cm6Selector;

    const describe = (selector) => {
      const elements = [...document.querySelectorAll(selector)];
      const element = elements.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) ?? elements[0] ?? null;
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        className: element.className,
        rect: {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        },
        selector,
        style: {
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontStyle: style.fontStyle,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          marginBottom: style.marginBottom,
          marginLeft: style.marginLeft,
          marginRight: style.marginRight,
          marginTop: style.marginTop,
          maxWidth: style.maxWidth,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
        },
        tagName: element.tagName,
      };
    };

    return {
      appMode: window.__app?.getMode?.() ?? null,
      block: describe(".cf-doc-block"),
      flow: describe(selectorForMode(".cf-doc-flow--cm6", ".cf-doc-flow--lexical")),
      h1: describe(".cf-doc-heading--h1"),
      math: describe(".cf-doc-display-math"),
      paragraph: describe(".cf-doc-paragraph"),
      surface: describe(selectorForMode(".cf-doc-surface--cm6", ".cf-doc-surface--lexical")),
      table: describe(".cf-doc-table-block"),
      tableCell: describe(".cf-doc-table-block th, .cf-doc-table-block td"),
    };
  }, mode);
}

function assertParity(cm6, lexical) {
  assertCondition(cm6.appMode === "cm6-rich", "CM6 rich mode did not activate", cm6.appMode);
  assertCondition(lexical.appMode === "lexical", "Lexical mode did not activate", lexical.appMode);

  for (const key of ["surface", "flow", "h1", "block", "math", "table", "tableCell"]) {
    assertCondition(cm6[key], `CM6 rich is missing ${key}`, cm6);
    assertCondition(lexical[key], `Lexical is missing ${key}`, lexical);
  }

  for (const property of ["color", "fontFamily", "fontSize", "lineHeight"]) {
    assertStyleEqual("flow", property, cm6.flow, lexical.flow);
  }
  for (const property of ["color", "fontSize", "fontStyle", "fontWeight", "lineHeight"]) {
    assertStyleEqual("h1", property, cm6.h1, lexical.h1);
  }
  for (const property of ["fontSize", "lineHeight"]) {
    assertStyleEqual("table cell", property, cm6.tableCell, lexical.tableCell);
  }

  assertNear("h1", "left", cm6.h1, lexical.h1, 24);
  assertNear("math", "left", cm6.math, lexical.math, 24);
  assertNear("table", "left", cm6.table, lexical.table, 24);
}

async function measureTypingLatency(page, mode) {
  const fixture = {
    ...PARITY_FIXTURE,
    displayPath: `fixture:document-surface-parity-${mode}.md`,
    virtualPath: `document-surface-parity-${mode}.md`,
  };
  await openFixtureDocument(page, fixture, {
    mode,
    project: "single-file",
    settleMs: 100,
  });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  return page.evaluate(async ({ anchorNeedle, insertText }) => {
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
    const percentile = (values, percentileValue) => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((left, right) => left - right);
      const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
      return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    };
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForFrames = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitForIdle = () =>
      new Promise((resolve) => {
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => resolve(), { timeout: 1000 });
          return;
        }
        setTimeout(resolve, 0);
      });

    const editor = window.__editor;
    if (!editor?.getDoc || !editor?.setSelection || !editor?.insertText || !editor?.focus) {
      throw new Error("window.__editor typing bridge is unavailable.");
    }
    await editor.ready;

    const before = editor.getDoc();
    const index = before.indexOf(anchorNeedle);
    if (index < 0) {
      throw new Error(`Typing anchor ${JSON.stringify(anchorNeedle)} is missing.`);
    }
    const anchor = index + anchorNeedle.length;
    editor.setSelection(anchor, anchor);
    editor.focus();
    await waitForFrames();

    const timings = [];
    const wallStart = performance.now();
    for (const char of insertText) {
      const charStart = performance.now();
      editor.insertText(char);
      timings.push(performance.now() - charStart);
    }
    const wallMs = performance.now() - wallStart;

    const expectedLength = before.length + insertText.length;
    const expectedText = `${anchorNeedle}${insertText}`;
    const canonicalStart = performance.now();
    let after = editor.getDoc();
    while (
      performance.now() - canonicalStart < 5_000 &&
      (after.length < expectedLength || !after.includes(expectedText))
    ) {
      await sleepInPage(8);
      after = editor.getDoc();
    }
    const canonicalMs = performance.now() - canonicalStart;
    if (after.length < expectedLength || !after.includes(expectedText)) {
      throw new Error(
        `Typing burst did not persist: expected length >= ${expectedLength}, ` +
          `got ${after.length}, expectedText=${JSON.stringify(expectedText)}`,
      );
    }

    const idleStart = performance.now();
    await waitForFrames();
    await waitForIdle();
    const inputToIdleMs = performance.now() - wallStart;

    return {
      canonicalMs,
      docLength: after.length,
      inputToIdleMs,
      insertCount: insertText.length,
      insertMaxMs: Math.max(...timings, 0),
      insertMeanMs: mean(timings),
      insertP95Ms: percentile(timings, 95),
      idleAfterInputMs: performance.now() - idleStart,
      wallMs,
      wallPerCharMs: wallMs / insertText.length,
    };
  }, {
    anchorNeedle: TYPING_ANCHOR,
    insertText: TYPING_INSERT,
  });
}

async function main() {
  let session = null;

  try {
    session = await openBrowserSession(process.argv.slice(2), {
      defaultBrowser: "managed",
    });
    await openFixtureDocument(session.page, PARITY_FIXTURE, {
      mode: "cm6-rich",
      project: "single-file",
    });
    const cm6 = await collectSurfaceMetrics(session.page, "cm6-rich");
    const lexical = await collectSurfaceMetrics(session.page, "lexical");
    assertParity(cm6, lexical);
    const typing = {
      cm6: await measureTypingLatency(session.page, "cm6-rich"),
      lexical: await measureTypingLatency(session.page, "lexical"),
    };
    console.log(JSON.stringify({
      status: "ok",
      cm6: {
        flow: cm6.flow.rect,
        h1: cm6.h1.rect,
        math: cm6.math.rect,
        table: cm6.table.rect,
      },
      lexical: {
        flow: lexical.flow.rect,
        h1: lexical.h1.rect,
        math: lexical.math.rect,
        table: lexical.table.rect,
      },
      typing,
    }, null, 2));
  } catch (error) {
    if (session?.artifactRecorder) {
      await session.artifactRecorder.collect({
        error,
        label: "document-surface-parity",
        root: session.artifactsRoot,
      }).then((artifacts) => {
        console.error(`Artifacts: ${artifacts.outDir}`);
      }).catch((artifactError) => {
        console.error(
          `Artifact collection failed: ${artifactError instanceof Error ? artifactError.message : String(artifactError)}`,
        );
      });
    }
    throw error;
  } finally {
    if (session) {
      await closeBrowserSession(session);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
