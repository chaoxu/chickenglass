#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import process from "node:process";
import { closeBrowserSession, openBrowserSession } from "./devx-browser-session.mjs";
import { createArgParser, normalizeCliArgs } from "./devx-cli.mjs";
import {
  openFile,
  openFixtureDocument,
  scrollToText,
  settleEditorLayout,
  switchToMode,
  waitForRenderReady,
} from "./test-helpers.mjs";
import { DEFAULT_RUNTIME_BUDGET_PROFILE } from "./runtime-budget-profiles.mjs";

const DEFAULT_TIMEOUT_MS = DEFAULT_RUNTIME_BUDGET_PROFILE.debugBridgeTimeoutMs;

export function sourceSnippet(doc, selection, radius = 80) {
  if (!selection || typeof doc !== "string") {
    return null;
  }
  const from = Math.max(0, Math.min(selection.from ?? selection.anchor ?? 0, doc.length));
  const to = Math.max(0, Math.min(selection.to ?? selection.focus ?? from, doc.length));
  const start = Math.max(0, from - radius);
  const end = Math.min(doc.length, to + radius);
  const lineColumn = lineColumnAt(doc, from);
  return {
    end,
    from,
    lineColumn,
    prefix: doc.slice(start, from),
    selected: doc.slice(from, to),
    start,
    suffix: doc.slice(to, end),
    to,
  };
}

function lineColumnAt(text, offset) {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < clamped; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return {
    col: clamped - lineStart + 1,
    line,
  };
}

export function summarizeConsoleMessage(message) {
  return {
    location: message.location?.() ?? null,
    text: typeof message.text === "function" ? message.text() : String(message.text ?? ""),
    type: typeof message.type === "function" ? message.type() : message.type ?? "unknown",
  };
}

async function clickSelector(page, selector) {
  return page.evaluate((cssSelector) => {
    const element = document.querySelector(cssSelector);
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      selector: cssSelector,
      width: rect.width,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, selector);
}

async function clickTextTarget(page, text, options = {}) {
  return page.evaluate(({ exact, needle }) => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const matches = (element) => {
      const content = normalize(element.textContent ?? "");
      return exact ? content === needle : content.includes(needle);
    };
    const candidates = [...document.querySelectorAll("*")].filter((element) =>
      isVisible(element) && matches(element)
    );
    const element = candidates.find((candidate) =>
      ![...candidate.children].some((child) => isVisible(child) && matches(child))
    ) ?? candidates[0] ?? null;
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      selector: null,
      text: needle,
      width: rect.width,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, {
    exact: Boolean(options.exact),
    needle: text,
  });
}

export async function collectBrowserInspection(page, options = {}) {
  const radius = Math.max(0, options.radius ?? 80);
  const state = await page.evaluate(({ exactText, selector, targetText }) => {
    const describeElement = (element) => {
      if (!(element instanceof Element)) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        ariaLabel: element.getAttribute("aria-label"),
        className: String(element.className ?? ""),
        id: element.id || null,
        role: element.getAttribute("role"),
        tagName: element.tagName,
        testId: element.getAttribute("data-testid"),
        text: (element.textContent ?? "").slice(0, 240),
        title: element.getAttribute("title"),
        rect: {
          height: rect.height,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        },
      };
    };

    const domPath = (element) => {
      const path = [];
      let current = element instanceof Element ? element : null;
      while (current && path.length < 8) {
        const id = current.id ? `#${current.id}` : "";
        const classes = String(current.className ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 4)
          .map((className) => `.${className}`)
          .join("");
        path.push(`${current.tagName.toLowerCase()}${id}${classes}`);
        current = current.parentElement;
      }
      return path;
    };

    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const textMatches = (element, text) => {
      const content = normalize(element.textContent ?? "");
      return exactText ? content === text : content.includes(text);
    };
    const findTextTarget = (text) => {
      if (!text) {
        return null;
      }
      const candidates = [...document.querySelectorAll("*")].filter((element) =>
        isVisible(element) && textMatches(element, text)
      );
      return candidates.find((element) =>
        ![...element.children].some((child) => isVisible(child) && textMatches(child, text))
      ) ?? candidates[0] ?? null;
    };

    const target = selector ? document.querySelector(selector) : findTextTarget(targetText);
    const doc = window.__editor?.getDoc?.() ?? window.__cmView?.state?.doc?.toString?.() ?? "";
    const selection = window.__editor?.getSelection?.() ?? (() => {
      const main = window.__cmView?.state?.selection?.main;
      return main
        ? { anchor: main.anchor, focus: main.head, from: main.from, to: main.to }
        : null;
    })();

    return {
      activeElement: describeElement(document.activeElement),
      activePath: domPath(document.activeElement),
      app: {
        currentDocument: window.__app?.getCurrentDocument?.() ?? null,
        dirty: window.__app?.isDirty?.() ?? null,
        mode: window.__app?.getMode?.() ?? null,
        sidebar: window.__app?.getSidebarState?.() ?? null,
      },
      browser: {
        readyState: document.readyState,
        title: document.title,
        url: location.href,
      },
      cmDebug: {
        motionGuards: window.__cmDebug?.motionGuards?.() ?? null,
        renderState: window.__cmDebug?.renderState?.() ?? null,
        selection: window.__cmDebug?.selection?.() ?? null,
        structure: window.__cmDebug?.structure?.() ?? null,
      },
      doc,
      editor: {
        selection,
      },
      targetElement: describeElement(target),
      targetPath: domPath(target),
    };
  }, {
    exactText: Boolean(options.exactText),
    selector: options.selector ?? "",
    targetText: options.clickText ?? "",
  });

  const { doc, ...publicState } = state;
  return {
    ...publicState,
    console: options.consoleMessages ?? [],
    editor: {
      ...state.editor,
      docLength: doc.length,
      sourceSnippet: sourceSnippet(doc, state.editor.selection, radius),
    },
  };
}

export async function runBrowserInspect(argv = process.argv.slice(2), io = {}) {
  const args = normalizeCliArgs(argv);
  const parser = createArgParser(args, {
    booleanFlags: ["--click", "--exact-text", "--help", "-h", "--json"],
    valueFlags: [
      "--click-text",
      "--file",
      "--fixture",
      "--mode",
      "--output",
      "--radius",
      "--selector",
      "--text",
      "--timeout",
    ],
  });
  if (parser.hasFlag("--help") || parser.hasFlag("-h")) {
    (io.stdout ?? process.stdout).write(`Usage:
  pnpm browser:inspect -- --fixture index.md --mode cm6-rich --text "Local PDF figure"
  pnpm browser:inspect -- --mode lexical --selector ".cf-lexical-inline-math" --click

Options:
  --fixture <path>   open a fixture/demo document through the app debug bridge
  --file <path>      open an app file path through window.__app.openFile()
  --mode <mode>      switch to cm6-rich, lexical, or source
  --text <needle>    scroll to visible text
  --selector <css>   include target DOM info; with --click, click its center first
  --click-text <txt> click the deepest visible element containing text
  --exact-text       require exact visible text for --click-text
  --radius <n>       source snippet radius around selection (default: 80)
  --output <path>    write JSON to file instead of stdout
`);
    return 0;
  }

  const timeout = parser.getIntFlag("--timeout", DEFAULT_TIMEOUT_MS);
  const radius = parser.getIntFlag("--radius", 80);
  const consoleMessages = [];
  const session = await openBrowserSession(args, { timeoutFallback: timeout });
  try {
    const page = session.page;
    page.on("console", (message) => {
      if (["error", "warning", "warn"].includes(message.type())) {
        consoleMessages.push(summarizeConsoleMessage(message));
      }
    });
    page.on("pageerror", (error) => {
      consoleMessages.push({
        location: null,
        text: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        type: "pageerror",
      });
    });

    const fixture = parser.getFlag("--fixture");
    const file = parser.getFlag("--file");
    const mode = parser.getFlag("--mode");
    if (fixture && file) {
      throw new Error("Use either --fixture or --file, not both.");
    }
    if (fixture) {
      await openFixtureDocument(page, fixture, {
        mode: mode || undefined,
        timeoutMs: timeout,
      });
    } else if (file) {
      await openFile(page, file);
      if (mode) {
        await switchToMode(page, mode);
      }
    } else if (mode) {
      await switchToMode(page, mode);
    }

    const text = parser.getFlag("--text");
    if (text) {
      await scrollToText(page, text);
    }
    await waitForRenderReady(page, { timeoutMs: timeout, frameCount: 2 });

    const selector = parser.getFlag("--selector");
    const clickText = parser.getFlag("--click-text");
    if (selector && clickText) {
      throw new Error("Use either --selector or --click-text, not both.");
    }
    let clickTarget = null;
    if (selector && parser.hasFlag("--click")) {
      clickTarget = await clickSelector(page, selector);
      if (clickTarget) {
        await page.mouse.click(clickTarget.x, clickTarget.y);
        await settleEditorLayout(page, { frameCount: 3, delayMs: 80 });
      }
    } else if (clickText) {
      clickTarget = await clickTextTarget(page, clickText, {
        exact: parser.hasFlag("--exact-text"),
      });
      if (!clickTarget) {
        throw new Error(`No visible click target found for text: ${clickText}`);
      }
      await page.mouse.click(clickTarget.x, clickTarget.y);
      await settleEditorLayout(page, { frameCount: 3, delayMs: 80 });
    }

    const inspection = await collectBrowserInspection(page, {
      clickText,
      consoleMessages,
      exactText: parser.hasFlag("--exact-text"),
      radius,
      selector,
    });
    const output = JSON.stringify({
      ...inspection,
      clickTarget,
    }, null, 2);
    const outputPath = parser.getFlag("--output");
    if (outputPath) {
      writeFileSync(outputPath, `${output}\n`);
    } else {
      (io.stdout ?? process.stdout).write(`${output}\n`);
    }
    return 0;
  } finally {
    await closeBrowserSession(session);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  runBrowserInspect().then((status) => {
    process.exit(status);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
