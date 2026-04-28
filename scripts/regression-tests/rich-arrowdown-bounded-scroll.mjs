import {
  clearMotionGuards,
  clearStructure,
  getSelectionState,
  getStructureState,
  openRegressionDocument,
  scrollTo,
  setCursor,
  settleEditorLayout,
  switchToMode,
} from "../test-helpers.mjs";

export const name = "rich-arrowdown-bounded-scroll";

const START_LINE = 150;
const STEP_COUNT = 260;
const MAX_DOWN_SCROLL_DELTA_PX = 170;
const MAX_REVERSE_SCROLL_DELTA_PX = 16;

function sample(page) {
  return Promise.all([
    getSelectionState(page),
    getStructureState(page),
    page.evaluate(() => {
    const scroller = window.__cmView.scrollDOM;
    return {
      scrollTop: Math.round(scroller.scrollTop),
      maxScrollTop: Math.round(scroller.scrollHeight - scroller.clientHeight),
      activeTableCells: document.querySelectorAll(".cf-table-cell-active").length,
      editingTableCells: document.querySelectorAll(".cf-table-cell-editing").length,
    };
    }),
  ]).then(([selection, structure, domState]) => ({
    ...domState,
    line: selection.line,
    head: selection.head,
    structure: structure?.kind ?? null,
  }));
}

function describeSample(state) {
  return [
    `line=${state.line}`,
    `head=${state.head}`,
    `scrollTop=${state.scrollTop}`,
    `max=${state.maxScrollTop}`,
    `structure=${state.structure ?? "none"}`,
    `activeTable=${state.activeTableCells}`,
    `editingTable=${state.editingTableCells}`,
  ].join(" ");
}

export async function run(page) {
  await openRegressionDocument(page, "index.md");
  await switchToMode(page, "cm6-rich");
  await scrollTo(page, START_LINE);
  await setCursor(page, START_LINE, 0);
  await page.evaluate(() => {
    window.__cmView.focus();
  });
  await clearStructure(page);
  await clearMotionGuards(page);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });

  let previous = await sample(page);
  let worstDownDelta = 0;
  let worstReverseDelta = 0;

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    await page.keyboard.press("ArrowDown");
    await settleEditorLayout(page, { frameCount: 1, delayMs: 45 });
    const current = await sample(page);
    const scrollDelta = current.scrollTop - previous.scrollTop;

    if (current.line < previous.line) {
      return {
        pass: false,
        message: `ArrowDown moved backward at step ${step}: ${describeSample(previous)} -> ${describeSample(current)}`,
      };
    }

    if (scrollDelta > worstDownDelta) {
      worstDownDelta = scrollDelta;
    }
    if (-scrollDelta > worstReverseDelta) {
      worstReverseDelta = -scrollDelta;
    }

    if (scrollDelta > MAX_DOWN_SCROLL_DELTA_PX) {
      return {
        pass: false,
        message: `ArrowDown scroll delta exceeded ${MAX_DOWN_SCROLL_DELTA_PX}px at step ${step}: delta=${scrollDelta}; ${describeSample(previous)} -> ${describeSample(current)}`,
      };
    }

    if (scrollDelta < -MAX_REVERSE_SCROLL_DELTA_PX) {
      return {
        pass: false,
        message: `ArrowDown reversed scroll by more than ${MAX_REVERSE_SCROLL_DELTA_PX}px at step ${step}: delta=${scrollDelta}; ${describeSample(previous)} -> ${describeSample(current)}`,
      };
    }

    previous = current;
  }

  return {
    pass: true,
    message: `bounded ${STEP_COUNT} ArrowDown steps from line ${START_LINE}; worst down=${worstDownDelta}px, worst reverse=${worstReverseDelta}px`,
  };
}
