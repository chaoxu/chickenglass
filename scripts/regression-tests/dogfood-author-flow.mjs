/**
 * Realistic author dogfood: theorem insertion, math edit, citation
 * autocomplete, save+reopen content fidelity, and a source-mode smoke
 * pass over the same fixture.
 *
 * Lives outside the default `pnpm test:browser` discovery (see
 * `excludeFromDefaultLane` below) and runs through the dedicated
 * `pnpm test:browser:dogfood` lane.
 */

import {
  assertEditorHealth,
  formatRuntimeIssues,
  insertEditorText,
  openFixtureDocument,
  pickAutocompleteOption,
  readEditorText,
  resolveFixtureDocument,
  saveCurrentFile,
  setCursor,
  switchToMode,
  waitForAutocomplete,
  waitForRenderReady,
  withRestoredFixture,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "dogfood-author-flow";
export const optionalFixtures = true;
export const excludeFromDefaultLane = true;

const FIXTURE = "dogfood/main.md";

async function findLineContaining(page, needle) {
  return page.evaluate((n) => {
    const view = window.__cmView;
    if (!view) throw new Error("CM6 view unavailable");
    const text = view.state.doc.toString();
    const idx = text.indexOf(n);
    if (idx < 0) throw new Error(`needle not found: ${n}`);
    return view.state.doc.lineAt(idx).number;
  }, needle);
}

async function pickBlockType(page, name) {
  // The cmdk picker mounts under .cf-block-picker. Set the input to the
  // exact entry name and dispatch Enter to select it.
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".cf-block-picker");
      if (!el) return false;
      return el.getAttribute("data-visible") === "true"
        && (el.querySelectorAll(".cf-block-picker-item").length > 0);
    },
    { timeout: 5000 },
  );
  await page.evaluate((blockName) => {
    const picker = document.querySelector(".cf-block-picker");
    const input = picker?.querySelector(".cf-block-picker-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("block picker input missing");
    }
    input.value = blockName;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  // Allow cmdk to filter, then press Enter.
  await page.waitForFunction(
    (blockName) => {
      const items = [...document.querySelectorAll(".cf-block-picker-item")];
      return items.some((item) => (item.textContent ?? "").toLowerCase().includes(blockName));
    },
    name,
    { timeout: 3000 },
  );
  await page.evaluate(() => {
    const input = document.querySelector(".cf-block-picker-input");
    if (input instanceof HTMLInputElement) {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    }
  });
  await page.waitForFunction(
    () => !document.querySelector(".cf-block-picker[data-visible='true']"),
    { timeout: 3000 },
  );
}

/** Trigger the block-type picker by inserting `\n:::` and re-running the
 *  third-colon input handler, mirroring `block-picker.mjs`. */
async function openBlockPickerAtDocEnd(page) {
  await page.evaluate(() => {
    const view = window.__cmView;
    const endPos = view.state.doc.length;
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
    if (!handled) view.dispatch(defaultInsert());
  });
}

async function runTheoremInsertion(page) {
  await openBlockPickerAtDocEnd(page);
  await pickBlockType(page, "theorem");
  await waitForRenderReady(page);

  // Type the theorem body. After insertBlock, the cursor lands inside the
  // block; insertEditorText goes through the active editor bridge.
  await insertEditorText(page, "Inserted dogfood theorem body.");
  await waitForRenderReady(page);

  const doc = await readEditorText(page);
  if (!/::: \{\.theorem[^}]*\}/.test(doc)) {
    throw new Error("expected an inserted theorem fenced div in the doc");
  }
  if (!doc.includes("Inserted dogfood theorem body.")) {
    throw new Error("expected typed theorem body to appear in the doc");
  }
  await assertEditorHealth(page, "after theorem insertion");
}

async function runMathEdit(page) {
  // Switch to source so we can target the math line text directly without
  // dealing with rich-mode display-math widgets.
  await switchToMode(page, "source");
  await waitForRenderReady(page);

  const lineNum = await findLineContaining(page, "E = m c^2");
  await setCursor(page, lineNum, "E = m c^2".length);
  await insertEditorText(page, " + \\delta");

  // Back to rich mode and confirm the math survives a re-render.
  await switchToMode(page, "rich");
  await waitForRenderReady(page);

  const doc = await readEditorText(page);
  if (!doc.includes("E = m c^2 + \\delta")) {
    throw new Error("expected edited display math to contain '+ \\\\delta'");
  }
  await assertEditorHealth(page, "after math edit");
}

async function runCitationInsertion(page) {
  await switchToMode(page, "rich");
  // Move cursor to the end of the doc and trigger citation autocomplete.
  await page.evaluate(() => {
    const view = window.__cmView;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });

  await insertEditorText(page, "\n\nFurther reading: @");
  await waitForAutocomplete(page);
  await pickAutocompleteOption(page, "stein2001");
  await waitForRenderReady(page);

  const doc = await readEditorText(page);
  if (!doc.includes("@stein2001")) {
    throw new Error("expected '@stein2001' citation to be inserted via autocomplete");
  }
  await assertEditorHealth(page, "after citation insertion");
}

async function runSaveAndReopen(page, originalContent) {
  // Append a small marker, save, close, reopen, verify the doc text matches.
  await switchToMode(page, "source");
  await page.evaluate(() => {
    const view = window.__cmView;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  const marker = "\n\n<!-- dogfood-marker -->\n";
  // Plain text append; FORMAT.md disallows raw inline HTML inside paragraphs
  // but a stand-alone HTML comment line round-trips as raw text in source.
  // We use plain markdown instead to stay format-clean:
  const trailingParagraph = "\n\nDogfood marker paragraph for save/reopen.\n";
  await insertEditorText(page, trailingParagraph);
  void marker;

  const expectedAfterEdit = await readEditorText(page);
  await saveCurrentFile(page);
  await page.waitForFunction(
    () => window.__app?.getCurrentDocument?.()?.dirty === false,
    { timeout: 5000 },
  );

  // Close and reopen via openFile; this round-trips through the filesystem
  // layer so we exercise actual persistence, not just in-memory state.
  await page.evaluate(async () => {
    await window.__app.closeFile({ discard: false });
  });
  await page.waitForFunction(
    () => window.__app?.getCurrentDocument?.() === null,
    { timeout: 5000 },
  );
  await page.evaluate(async (path) => {
    await window.__app.openFile(path);
  }, FIXTURE);
  await waitForRenderReady(page);

  const reloaded = await readEditorText(page);
  if (reloaded !== expectedAfterEdit) {
    throw new Error(
      `save+reopen content mismatch: expectedLen=${expectedAfterEdit.length} got=${reloaded.length}`,
    );
  }
  if (!reloaded.includes("Dogfood marker paragraph for save/reopen.")) {
    throw new Error("save+reopen lost the appended marker paragraph");
  }
  // Original content must still be a prefix — no corruption of the head.
  if (!reloaded.startsWith(originalContent.slice(0, 200))) {
    throw new Error("save+reopen corrupted the document prefix");
  }
  await assertEditorHealth(page, "after save+reopen");
}

async function runSourceModeSmoke(page) {
  await switchToMode(page, "source");
  await waitForRenderReady(page);
  const sourceText = await readEditorText(page);
  if (!sourceText.includes("::: {.theorem")) {
    throw new Error("source-mode smoke: theorem fence missing from raw markdown");
  }
  if (!sourceText.includes("$$")) {
    throw new Error("source-mode smoke: display-math fence missing from raw markdown");
  }
  await assertEditorHealth(page, "source-mode smoke");
}

export async function run(page) {
  const fixture = resolveFixtureDocument(FIXTURE);
  const originalContent = fixture.content;

  const { value, issues } = await withRuntimeIssueCapture(page, async () => {
    await openFixtureDocument(page, FIXTURE, {
      project: "full-project",
      mode: "rich",
    });
    await assertEditorHealth(page, "dogfood fixture loaded");

    await withRestoredFixture(
      page,
      { path: fixture.virtualPath, content: originalContent },
      async () => {
        await runTheoremInsertion(page);
        await runMathEdit(page);
        await runCitationInsertion(page);
        await runSaveAndReopen(page, originalContent);
        await runSourceModeSmoke(page);
      },
    );

    const finalHealth = await assertEditorHealth(page, "after dogfood flow");
    return {
      mode: finalHealth.mode,
      docLength: finalHealth.docLength,
      semanticRevision: finalHealth.semantics?.revision,
    };
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues during dogfood author flow: ${formatRuntimeIssues(issues)}`,
    };
  }

  return {
    pass: true,
    message:
      `theorem insert + math edit + citation + save/reopen + source smoke stayed healthy ` +
      `(mode=${value.mode}, doc=${value.docLength}, revision=${value.semanticRevision})`,
  };
}
