import {
  openRegressionDocument,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "whole-document-arrowdown-sweep";

function selectionSignature(page) {
  return page.evaluate(() => {
    const root = window.__cmDebug.selection();
    const scroller = window.__cmView?.scrollDOM;
    const structure = window.__cmDebug.structure()?.kind ?? null;
    const domSel = window.getSelection();
    const range = domSel && domSel.rangeCount ? domSel.getRangeAt(0) : null;
    const rect = range ? range.getBoundingClientRect() : null;
    const activeEl = document.activeElement;
    const activeEditor = activeEl?.closest?.(".cm-editor");
    const activeCell = activeEl?.closest?.("td, th, .cf-table-widget, .cf-block, .cm-content");
    const anchorNode = domSel?.anchorNode ?? null;
    const anchorText = anchorNode?.nodeType === Node.TEXT_NODE
      ? anchorNode.textContent
      : anchorNode?.textContent;
    return {
      docLines: window.__cmView.state.doc.lines,
      rootHead: root.head,
      rootLine: root.line,
      rootCol: root.col,
      structure,
      activeTag: activeEl?.tagName ?? null,
      activeClass: activeEl?.className ?? null,
      activeEditorClass: activeEditor?.className ?? null,
      activeCellText: activeCell ? activeCell.textContent?.replace(/\s+/g, " ").slice(0, 80) : null,
      anchorOffset: domSel?.anchorOffset ?? null,
      anchorText: anchorText ? anchorText.replace(/\s+/g, " ").slice(0, 80) : null,
      rectTop: rect ? Math.round(rect.top) : null,
      rectLeft: rect ? Math.round(rect.left) : null,
      rectWidth: rect ? Math.round(rect.width) : null,
      rectHeight: rect ? Math.round(rect.height) : null,
      editorScrollTop: Math.round(scroller?.scrollTop ?? 0),
      scrollY: Math.round(window.scrollY),
    };
  });
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "cm6-rich");
  await page.evaluate(() => {
    window.__cmView.focus();
    window.__cmDebug.clearStructure();
    window.__cmDebug.clearMotionGuards();
  });
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  let repeated = 0;
  let previousSignature = null;
  let state = await selectionSignature(page);
  let previousState = null;

  for (let step = 0; step < 1200; step += 1) {
    state = await selectionSignature(page);
    if (previousState) {
      if (state.rootLine < previousState.rootLine) {
        return {
          pass: false,
          message: `ArrowDown moved backward in document lines: ${JSON.stringify({ step, previousState, state })}`,
        };
      }
      if (state.editorScrollTop + 40 < previousState.editorScrollTop) {
        return {
          pass: false,
          message: `ArrowDown scrolled backward in the editor: ${JSON.stringify({ step, previousState, state })}`,
        };
      }
    }
    const signature = JSON.stringify(state);
    if (signature === previousSignature) {
      repeated += 1;
    } else {
      repeated = 0;
      previousSignature = signature;
    }
    previousState = state;

    if (repeated >= 3) {
      if (state.rootLine >= state.docLines) {
        return {
          pass: true,
          message: `ArrowDown swept to document end at line ${state.rootLine}`,
        };
      }
      return {
        pass: false,
        message: `ArrowDown stalled before document end: ${JSON.stringify({ step, repeated, state })}`,
      };
    }

    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(30);
  }

  return {
    pass: false,
    message: `ArrowDown did not settle by the end of the sweep budget: ${JSON.stringify(state)}`,
  };
}
