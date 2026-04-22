import {
  openFixtureDocument,
  saveCurrentFile,
  settleEditorLayout,
} from "../test-helpers.mjs";

export const name = "generated-document-save";

const GENERATED_SAVE_FIXTURE = {
  virtualPath: "generated-save-status.md",
  displayPath: "generated:generated-save-status.md",
  content: [
    "# Generated Save Status",
    "",
    "This document is opened through openFileWithContent and should become a real file on save.",
    "",
  ].join("\n"),
};

async function captureSaveState(page) {
  return page.evaluate(async () => {
    const currentDocument = window.__app?.getCurrentDocument?.() ?? null;
    return {
      dirty: currentDocument?.dirty ?? null,
      path: currentDocument?.path ?? null,
      saveStatusText: document.querySelector("[data-testid='save-status']")?.textContent ?? null,
      hasFile: currentDocument?.path
        ? await (window.__app?.hasFile?.(currentDocument.path) ?? null)
        : null,
    };
  });
}

export async function run(page) {
  await openFixtureDocument(page, GENERATED_SAVE_FIXTURE, { mode: "cm6-rich" });
  await settleEditorLayout(page, { frameCount: 2, delayMs: 64 });

  const beforeSave = await captureSaveState(page);
  if (beforeSave.dirty !== true || beforeSave.saveStatusText !== "Unsaved") {
    return {
      pass: false,
      message: `generated document should start dirty/unsaved: ${JSON.stringify(beforeSave)}`,
    };
  }

  await saveCurrentFile(page);
  await page.waitForFunction(() => {
    const currentDocument = window.__app?.getCurrentDocument?.() ?? null;
    return currentDocument?.dirty === false
      && document.querySelector("[data-testid='save-status']")?.textContent === "Saved";
  });

  const afterSave = await captureSaveState(page);
  if (afterSave.dirty !== false || afterSave.saveStatusText !== "Saved") {
    return {
      pass: false,
      message: `generated document did not become saved: ${JSON.stringify(afterSave)}`,
    };
  }

  const hasFile = await page.evaluate((path) => window.__app?.hasFile?.(path) ?? false, GENERATED_SAVE_FIXTURE.virtualPath);
  if (!hasFile) {
    return {
      pass: false,
      message: `generated document was marked saved but ${GENERATED_SAVE_FIXTURE.virtualPath} was not created`,
    };
  }

  return {
    pass: true,
    message: "generated openFileWithContent document saved as a real file without conflict",
  };
}
