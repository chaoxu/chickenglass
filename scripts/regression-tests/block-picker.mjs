/**
 * Regression test: block picker readiness.
 *
 * Simulates typing the third `:` through CodeMirror's actual input-handler
 * chain and verifies the block-type picker opens and consumes the trigger
 * line. This avoids flaky remote keyboard delivery while still exercising the
 * real picker trigger path.
 */

/* global window */

import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "block-picker";

export async function run(page) {
  await openRegressionDocument(page);
  await new Promise((r) => setTimeout(r, 800));

  // Ensure rich mode
  await page.evaluate(() => window.__app.setMode("rich"));
  await new Promise((r) => setTimeout(r, 300));

  const result = await page.evaluate(() => {
    const view = window.__cmView;
    const endPos = view.state.doc.length;
    try {
      view.dispatch({
        changes: { from: endPos, insert: "\n::" },
        selection: { anchor: endPos + 3 },
      });
      const from = view.state.selection.main.head;
      const handlers = view.state.facet(view.constructor.inputHandler);
      const defaultInsert = () => view.state.update({
        changes: { from, to: from, insert: ":" },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      const handled = handlers.some((handler) => handler(view, from, from, ":", defaultInsert));
      if (!handled) {
        view.dispatch(defaultInsert());
      }
      const picker = document.querySelector(".cf-block-picker");
      const lineAt = view.state.doc.lineAt(view.state.selection.main.head);
      return {
        handled,
        pickerVisible: picker ? getComputedStyle(picker).display !== "none" : false,
        itemCount: picker?.querySelectorAll(".cf-block-picker-item").length ?? 0,
        lineText: lineAt.text,
      };
    } finally {
      const input = document.querySelector(".cf-block-picker-input");
      if (input instanceof HTMLInputElement) {
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }));
      }
      if (view.state.doc.length > endPos) {
        view.dispatch({
          changes: { from: endPos, to: view.state.doc.length, insert: "" },
          selection: { anchor: endPos },
        });
      }
    }
  });

  if (!result.handled) {
    return {
      pass: false,
      message: "Expected the block-type input handler to intercept the third colon",
    };
  }

  if (!result.pickerVisible || result.itemCount === 0) {
    return {
      pass: false,
      message: `Expected the block picker to open with items, got visible=${result.pickerVisible} count=${result.itemCount}`,
    };
  }

  if (result.lineText !== "") {
    return {
      pass: false,
      message: `Expected the trigger line to be cleared after opening the picker, got ${JSON.stringify(result.lineText)}`,
    };
  }

  return { pass: true, message: `${result.itemCount} block types available` };
}
