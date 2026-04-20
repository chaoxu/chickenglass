import { openRegressionDocument, setRevealPresentation } from "../test-helpers.mjs";

export const name = "rich-surface-overlays";
export const groups = ["core", "surfaces"];

function nearlyEqual(left, right, tolerance = 3) {
  return Math.abs(left - right) <= tolerance;
}

export async function run(page) {
  // Reference/citation overlay layout assertions target the floating panel
  // (cf-lexical-inline-token-panel-shell) — switch to that presentation since
  // the default reveal is now inline-swap.
  await setRevealPresentation(page, "floating");
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const state = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const normalizeText = (value) => value?.replace(/\s+/g, " ").trim() ?? "";
    const normalizeRect = (rect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    });
    const surface = document.querySelector(".cf-lexical-surface--scroll");
    if (!(surface instanceof HTMLElement)) {
      return { error: "missing editor scroll surface" };
    }

    const caption = document.querySelector(".cf-lexical-block--table .cf-lexical-block-caption");
    const captionLabel = caption?.querySelector(".cf-lexical-block-caption-label");
    const captionText = caption?.querySelector(".cf-lexical-block-caption-text");
    const captionState = caption && captionLabel && captionText
      ? {
          labelRect: normalizeRect(captionLabel.getBoundingClientRect()),
          labelText: normalizeText(captionLabel.textContent),
          textRect: normalizeRect(captionText.getBoundingClientRect()),
          textText: normalizeText(captionText.textContent),
        }
      : null;

    const codeBlock = document.querySelector(".cf-codeblock-body")?.parentElement;
    const codeLabel = document.querySelector(".cf-codeblock-language");
    const codeCopy = document.querySelector(".cf-codeblock-copy");
    if (
      !(codeBlock instanceof HTMLElement)
      || !(codeLabel instanceof HTMLElement)
      || !(codeCopy instanceof HTMLElement)
    ) {
      return { error: "missing code block chrome", captionState };
    }

    const readCodeChrome = () => {
      const blockRect = codeBlock.getBoundingClientRect();
      const labelRect = codeLabel.getBoundingClientRect();
      const copyRect = codeCopy.getBoundingClientRect();
      return {
        blockRect: normalizeRect(blockRect),
        copyLeft: copyRect.left - blockRect.left,
        copyTop: copyRect.top - blockRect.top,
        labelLeft: labelRect.left - blockRect.left,
        labelTop: labelRect.top - blockRect.top,
      };
    };

    const codeBefore = readCodeChrome();
    surface.scrollTop += 300;
    await sleep(120);
    const codeAfter = readCodeChrome();

    const citation = [...document.querySelectorAll(".cf-citation")].find((candidate) =>
      candidate instanceof HTMLElement
      && !candidate.closest(".cf-lexical-table-block")
    );
    if (!(citation instanceof HTMLElement)) {
      return { error: "missing citation source anchor", captionState, codeAfter, codeBefore };
    }

    citation.scrollIntoView({ block: "center" });
    await sleep(120);
    citation.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    citation.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    citation.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    await sleep(160);

    const readReferenceEditor = () => {
      const currentCitation = [...document.querySelectorAll(".cf-citation")].find((candidate) =>
        candidate instanceof HTMLElement
        && !candidate.closest(".cf-lexical-table-block")
      );
      const panel = document.querySelector(".cf-lexical-inline-token-panel-shell");
      if (!(currentCitation instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return null;
      }
      const anchorRect = currentCitation.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return {
        gap: panelRect.top - anchorRect.bottom,
        leftDelta: panelRect.left - anchorRect.left,
        panelRect: normalizeRect(panelRect),
      };
    };

    const referenceBefore = readReferenceEditor();
    surface.scrollTop += 80;
    await sleep(120);
    const referenceAfter = readReferenceEditor();

    return {
      captionState,
      codeAfter,
      codeBefore,
      referenceAfter,
      referenceBefore,
    };
  });

  if (state.error) {
    return { pass: false, message: state.error };
  }

  if (!state.captionState) {
    return { pass: false, message: "table caption did not render on the Lexical surface" };
  }

  if (state.captionState.labelText !== "Table 1") {
    return {
      pass: false,
      message: `table caption label text drifted to ${JSON.stringify(state.captionState.labelText)}`,
    };
  }
  if (state.captionState.textText !== "Feature coverage matrix") {
    return {
      pass: false,
      message: `table caption text drifted to ${JSON.stringify(state.captionState.textText)}`,
    };
  }
  if (!nearlyEqual(state.captionState.labelRect.top, state.captionState.textRect.top, 2)) {
    return { pass: false, message: "table caption label and body no longer share one line" };
  }
  if (state.captionState.textRect.left + 1 < state.captionState.labelRect.right) {
    return { pass: false, message: "table caption body overlapped the label instead of following it inline" };
  }

  if (!nearlyEqual(state.codeBefore.labelTop, state.codeAfter.labelTop, 2)) {
    return { pass: false, message: "code block language badge drifted relative to its code block while scrolling" };
  }
  if (!nearlyEqual(state.codeBefore.copyTop, state.codeAfter.copyTop, 2)) {
    return { pass: false, message: "code block copy button drifted relative to its code block while scrolling" };
  }
  if (state.codeAfter.labelTop < -2 || state.codeAfter.copyTop < -2) {
    return { pass: false, message: "code block chrome escaped the code block after scrolling" };
  }

  if (!state.referenceBefore || !state.referenceAfter) {
    return { pass: false, message: "reference source editor did not stay mounted while scrolling" };
  }
  if (!nearlyEqual(state.referenceBefore.leftDelta, state.referenceAfter.leftDelta, 2)) {
    return { pass: false, message: "reference source editor lost horizontal alignment while scrolling" };
  }
  if (!nearlyEqual(state.referenceBefore.gap, state.referenceAfter.gap, 4)) {
    return { pass: false, message: "reference source editor drifted away from its anchor while scrolling" };
  }

  return {
    pass: true,
    message: "captions stay inline and floating chrome stays attached to the editor surface while scrolling",
  };
}
