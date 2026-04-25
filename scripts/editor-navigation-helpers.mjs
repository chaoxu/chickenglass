/* global window, document, HTMLElement, Number, requestAnimationFrame, setTimeout */

import {
  settleEditorLayout,
  waitForAnimationFrames,
} from "./editor-wait-helpers.mjs";

export async function findLine(page, needle) {
  return page.evaluate((text) => {
    const docText = window.__editor?.getDoc?.() ?? window.__cmView.state.doc.toString();
    const lines = docText.split("\n");
    for (let line = 1; line <= lines.length; line += 1) {
      if (lines[line - 1].includes(text)) {
        return line;
      }
    }
    return -1;
  }, needle);
}

/**
 * Resolve the nth occurrence of `needle` in the document, returning the
 * document anchor plus 1-based line/column coordinates.
 */
export function resolveTextAnchorInDocument(
  documentText,
  needle,
  { occurrence = 1, offset = 0 } = {},
) {
  if (typeof needle !== "string" || needle.length === 0) {
    throw new Error("Text anchor needle must be a non-empty string.");
  }
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error(`Text anchor occurrence must be a positive integer; got ${occurrence}.`);
  }
  if (!Number.isInteger(offset)) {
    throw new Error(`Text anchor offset must be an integer; got ${offset}.`);
  }

  const lines = documentText.split("\n");
  let lineStart = 0;
  let seen = 0;

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const lineText = lines[lineNumber - 1];
    let searchFrom = 0;

    while (searchFrom <= lineText.length) {
      const matchIndex = lineText.indexOf(needle, searchFrom);
      if (matchIndex < 0) {
        break;
      }

      seen += 1;
      if (seen === occurrence) {
        const lineEnd = lineStart + lineText.length;
        const anchor = Math.max(
          lineStart,
          Math.min(lineEnd, lineStart + matchIndex + offset),
        );

        return {
          line: lineNumber,
          col: anchor - lineStart + 1,
          anchor,
        };
      }

      searchFrom = matchIndex + needle.length;
    }

    lineStart += lineText.length + 1;
  }

  return null;
}

/**
 * Jump to the nth occurrence of `needle`, placing the cursor at the matched
 * text plus an optional character offset.
 */
export async function jumpToTextAnchor(
  page,
  needle,
  { occurrence = 1, offset = 0 } = {},
) {
  const documentText = await page.evaluate(() =>
    window.__editor?.getDoc?.() ?? window.__cmView.state.doc.toString()
  );
  const result = resolveTextAnchorInDocument(documentText, needle, {
    occurrence,
    offset,
  });

  if (!result) {
    throw new Error(`Failed to find text anchor ${JSON.stringify(needle)} (occurrence ${occurrence}).`);
  }

  await page.evaluate(({ anchor }) => {
    if (window.__editor) {
      window.__editor.focus();
      window.__editor.setSelection(anchor);
      return;
    }
    const view = window.__cmView;
    view.focus();
    view.dispatch({
      selection: { anchor },
      scrollIntoView: true,
    });
  }, { anchor: result.anchor });

  await settleEditorLayout(page, { frameCount: 2 });
  return result;
}

/**
 * Open explicit structure editing at the current cursor.
 */
export async function activateStructureAtCursor(page) {
  const activated = await page.evaluate(() => window.__cmDebug.activateStructureAtCursor());
  await settleEditorLayout(page);
  return activated;
}

/**
 * Clear the active explicit structure-edit target.
 */
export async function clearStructure(page) {
  const cleared = await page.evaluate(() => window.__cmDebug.clearStructure());
  await settleEditorLayout(page);
  return cleared;
}

/**
 * Clear recent vertical-motion guard events.
 */
export async function clearMotionGuards(page) {
  await page.evaluate(() => window.__cmDebug.clearMotionGuards());
  await waitForAnimationFrames(page, 1);
}

/**
 * Place cursor at a specific line and column, with focus.
 */
export async function setCursor(page, line, col = 0) {
  await page.evaluate(
    ({ line, col }) => {
      const view = window.__cmView;
      view.focus();
      const lines = view.state.doc.toString().split("\n");
      const clampedLine = Math.max(1, Math.min(line, lines.length));
      let anchor = 0;
      for (let index = 0; index < clampedLine - 1; index += 1) {
        anchor += lines[index].length + 1;
      }
      const lineText = lines[clampedLine - 1] ?? "";
      anchor += Math.max(0, Math.min(col, lineText.length));
      view.dispatch({ selection: { anchor } });
    },
    { line, col },
  );
  await settleEditorLayout(page);
}

/**
 * Scroll the editor to show a specific line near the top.
 */
export async function scrollTo(page, line) {
  await page.evaluate((ln) => {
    const view = window.__cmView;
    const editor = window.__editor;
    const doc = view?.state?.doc?.toString?.() ?? editor?.getDoc?.();
    if (typeof doc !== "string") {
      throw new Error("No active editor document is available for scrollTo().");
    }
    const lines = doc.split("\n");
    const clampedLine = Math.max(1, Math.min(ln, lines.length));
    let anchor = 0;
    for (let index = 0; index < clampedLine - 1; index += 1) {
      anchor += lines[index].length + 1;
    }

    if (!view?.scrollDOM) {
      if (!editor) {
        throw new Error("No active editor bridge is available for scrollTo().");
      }
      editor.setSelection(anchor, anchor);
      editor.focus?.();

      const root = document.querySelector("[data-lexical-editor].cf-lexical-editor");
      const surface = root?.closest(".cf-lexical-surface--scroll")
        ?? root?.parentElement
        ?? document.scrollingElement
        ?? document.documentElement;
      if (!(surface instanceof HTMLElement) && surface !== document.documentElement) {
        return;
      }

      const candidates = root
        ? [...root.querySelectorAll("[data-coflat-source-from], [data-coflat-heading-pos]")]
        : [];
      let target = root;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) continue;
        const from = Number(candidate.dataset.coflatSourceFrom ?? candidate.dataset.coflatHeadingPos);
        const to = Number(candidate.dataset.coflatSourceTo ?? from);
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        const containsAnchor = from <= anchor && anchor <= to;
        const distance = containsAnchor ? 0 : Math.min(Math.abs(anchor - from), Math.abs(anchor - to));
        if (distance < bestDistance) {
          bestDistance = distance;
          target = candidate;
        }
      }

      if (!(target instanceof HTMLElement)) {
        return;
      }
      const scrollElement = surface instanceof HTMLElement ? surface : document.documentElement;
      const coords = target.getBoundingClientRect();
      const rect = scrollElement.getBoundingClientRect();
      const viewportHeight = scrollElement.clientHeight || window.innerHeight || 800;
      const targetTop = rect.top + Math.min(120, viewportHeight / 3);
      scrollElement.scrollTop = Math.max(
        0,
        scrollElement.scrollTop + coords.top - targetTop,
      );
      return;
    }

    view.focus();
    view.dispatch({
      selection: { anchor },
      scrollIntoView: true,
    });
    const coords = view.coordsAtPos(anchor, 1) ?? view.coordsAtPos(anchor, -1);
    if (!coords) return;
    const rect = view.scrollDOM.getBoundingClientRect();
    const targetTop = rect.top + Math.min(120, view.scrollDOM.clientHeight / 3);
    view.scrollDOM.scrollTop = Math.max(
      0,
      view.scrollDOM.scrollTop + coords.top - targetTop,
    );
  }, line);
  await settleEditorLayout(page, { frameCount: 3 });
}

/**
 * Scroll the editor so the first line containing `needle` is visible.
 */
export async function scrollToText(page, needle) {
  const line = await findLine(page, needle);
  if (line < 0) {
    throw new Error(`Missing line containing "${needle}"`);
  }
  await scrollTo(page, line);
  return line;
}

export async function traceVerticalCursorMotion(page, options = {}) {
  return page.evaluate(async (config) => {
    const view = window.__cmView;
    const debug = window.__cmDebug;
    if (!view || !debug) {
      throw new Error("window.__cmView or window.__cmDebug is unavailable.");
    }

    const direction = config.direction === "down" ? "down" : "up";
    const steps = Math.max(0, config.steps ?? 0);
    const settleMs = Math.max(0, config.settleMs ?? 32);
    const contextRadius = Math.max(0, config.contextRadius ?? 2);

    const waitForFrame = () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timeoutId = setTimeout(finish, 50);
        requestAnimationFrame(() => {
          clearTimeout(timeoutId);
          finish();
        });
      });

    const waitForSettle = async (delayOverride = settleMs) => {
      await waitForFrame();
      await waitForFrame();
      if (delayOverride > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayOverride));
      }
    };

    const clampLine = (lineNumber) =>
      Math.max(1, Math.min(lineNumber, view.state.doc.lines));
    const clampHead = (head) =>
      Math.max(0, Math.min(head, view.state.doc.length));

    const collectNearbyLines = (lineNumber) => {
      const lines = [];
      const fromLine = clampLine(lineNumber - contextRadius);
      const toLine = clampLine(lineNumber + contextRadius);
      for (let line = fromLine; line <= toLine; line += 1) {
        lines.push({
          line,
          text: view.state.doc.line(line).text,
          info: debug.line(line),
        });
      }
      return lines;
    };

    const collectStep = (step) => {
      const selection = view.state.selection.main;
      const line = view.state.doc.lineAt(selection.head);
      const coords = view.coordsAtPos(selection.head)
        ?? (selection.head > 0 ? view.coordsAtPos(selection.head - 1, 1) : null)
        ?? (selection.head < view.state.doc.length ? view.coordsAtPos(selection.head + 1, -1) : null);

      return {
        step,
        head: selection.head,
        anchor: selection.anchor,
        line: line.number,
        lineText: line.text,
        scrollTop: view.scrollDOM.scrollTop,
        cursorTop: coords?.top ?? null,
        cursorBottom: coords?.bottom ?? null,
        lineInfo: debug.line(line.number),
        nearbyLines: collectNearbyLines(line.number),
      };
    };

    const anchorCursorIntoViewport = () => {
      const head = view.state.selection.main.head;
      const coords = view.coordsAtPos(head)
        ?? (head > 0 ? view.coordsAtPos(head - 1, 1) : null)
        ?? (head < view.state.doc.length ? view.coordsAtPos(head + 1, -1) : null);
      if (!coords) return;
      const viewportHeight = view.scrollDOM.clientHeight || 800;
      if (coords.top < 0 || coords.bottom > viewportHeight) {
        view.scrollDOM.scrollTop = Math.max(0, coords.top - Math.min(200, viewportHeight / 3));
      }
    };

    if (typeof config.startHead === "number") {
      const head = clampHead(config.startHead);
      view.focus();
      view.dispatch({ selection: { anchor: head }, scrollIntoView: true });
    } else if (typeof config.startLine === "number") {
      const lineNumber = clampLine(config.startLine);
      const line = view.state.doc.line(lineNumber);
      const column = Math.max(0, Math.min(config.startColumn ?? 0, line.text.length));
      view.focus();
      view.dispatch({
        selection: { anchor: Math.min(line.to, line.from + column) },
        scrollIntoView: true,
      });
    } else {
      view.focus();
    }

    await waitForSettle(Math.max(settleMs, 200));
    anchorCursorIntoViewport();
    await waitForSettle(Math.max(settleMs, 50));

    const trace = [collectStep(0)];
    let stopReason = null;

    for (let step = 1; step <= steps; step += 1) {
      const moved = typeof debug.moveVertically === "function"
        ? debug.moveVertically(direction)
        : (() => {
            const previousRange = view.state.selection.main;
            const nextRange = view.moveVertically(previousRange, direction === "down");
            if (
              nextRange.anchor === previousRange.anchor &&
              nextRange.head === previousRange.head
            ) {
              return false;
            }
            view.dispatch({
              selection: view.state.selection.replaceRange(nextRange),
              scrollIntoView: true,
            });
            return true;
          })();

      if (!moved) {
        const previousRange = view.state.selection.main;
        const currentLine = view.state.doc.lineAt(previousRange.head).number;
        stopReason = currentLine === 1 && direction === "up"
          ? "top-boundary"
          : currentLine === view.state.doc.lines && direction === "down"
            ? "bottom-boundary"
            : "stalled";
        break;
      }
      await waitForSettle();
      trace.push(collectStep(step));
    }

    return {
      direction,
      trace,
      stopReason,
    };
  }, options);
}
