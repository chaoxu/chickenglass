/**
 * Regression test: GFM task-list checkboxes stay rendered and toggleable.
 */

/* global MouseEvent, window */

import {
  openFixtureDocument,
  readEditorText,
  sleep,
} from "../test-helpers.mjs";

export const name = "task-checkboxes";

const TASK_CHECKBOX_FIXTURE = {
  virtualPath: "task-checkboxes.md",
  displayPath: "generated:task-checkboxes.md",
  content: [
    "# Task Checkbox Regression",
    "",
    "Plain prose before the task list.",
    "",
    "- [ ] First task",
    "- [x] Done task",
    "",
  ].join("\n"),
};

async function readCheckboxState(page) {
  return page.evaluate(() => {
    const view = window.__cmView;
    const inputs = [...view.dom.querySelectorAll('input[type="checkbox"]')];
    return inputs.map((input) => ({
      checked: input instanceof HTMLInputElement ? input.checked : null,
      label: input.getAttribute("aria-label"),
    }));
  });
}

export async function run(page) {
  await openFixtureDocument(page, TASK_CHECKBOX_FIXTURE, { mode: "cm6-rich" });
  await sleep(500);

  const before = await readCheckboxState(page);
  if (
    before.length !== 2 ||
    before[0]?.checked !== false ||
    before[1]?.checked !== true
  ) {
    return {
      pass: false,
      message: `expected unchecked+checked task widgets before edit: ${JSON.stringify(before)}`,
    };
  }

  await page.evaluate(() => {
    const doc = window.__editor.getDoc();
    const prosePos = doc.indexOf("Plain prose") + "Plain".length;
    window.__editor.setSelection(prosePos, prosePos);
    window.__editor.insertText(" inserted");
  });
  await page.waitForFunction(
    () => window.__editor?.getDoc?.().includes("Plain inserted prose"),
    null,
    { timeout: 5_000, polling: 100 },
  );
  await sleep(250);

  const afterProseEdit = await readCheckboxState(page);
  if (
    afterProseEdit.length !== 2 ||
    afterProseEdit[0]?.checked !== false ||
    afterProseEdit[1]?.checked !== true
  ) {
    return {
      pass: false,
      message: `task widgets did not survive unrelated prose edit: ${JSON.stringify(afterProseEdit)}`,
    };
  }

  const toggled = await page.evaluate(() => {
    const first = window.__cmView.dom.querySelector('input[type="checkbox"]');
    if (!(first instanceof HTMLInputElement)) {
      return false;
    }
    first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    return true;
  });
  if (!toggled) {
    return { pass: false, message: "could not dispatch checkbox toggle event" };
  }

  await page.waitForFunction(
    () => window.__editor?.getDoc?.().includes("- [x] First task"),
    null,
    { timeout: 5_000, polling: 100 },
  );
  const finalDoc = await readEditorText(page);
  const afterToggle = await readCheckboxState(page);
  if (!finalDoc.includes("- [x] First task") || afterToggle[0]?.checked !== true) {
    return {
      pass: false,
      message: `checkbox toggle did not update markdown/widget: ${JSON.stringify({
        afterToggle,
        finalDoc,
      })}`,
    };
  }

  return {
    pass: true,
    message: "2 task widgets survived prose edit and first task toggled to checked",
  };
}
