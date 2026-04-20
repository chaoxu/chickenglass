import {
  setRevealPresentation,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "reference-rendering-edge-cases";
export const groups = ["index"];

const MAIN = [
  "---",
  "bibliography: refs.bib",
  "---",
  "",
  "Math $x+1$ after.",
  "",
  "Before [@mathref] after citation.",
  "",
  "Cluster [@mathref; @secondref] after cluster.",
  "",
  "::: Proof",
  "The proof body.",
  ":::",
  "",
  ":::: {.figure #fig:missing-png} Missing PNG",
  "![Missing PNG](missing-preview.png)",
  "::::",
  "",
].join("\n");

const BIB = [
  "@article{mathref,",
  "  author = {Doe, Jane},",
  "  title = {A $k$-hitting set},",
  "  year = {2020},",
  "}",
  "",
  "@article{secondref,",
  "  author = {Smith, Ada},",
  "  title = {Second clustered citation},",
  "  year = {2021},",
  "}",
  "",
].join("\n");

async function openReferenceFixture(page) {
  await page.evaluate(async ({ bib, main }) => {
    const app = window.__app;
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore stale cleanup between cases.
      }
    }
    app.setMode("lexical");
    if (app.loadFixtureProject) {
      await app.loadFixtureProject([
        { content: main, kind: "text", path: "main.md" },
        { content: bib, kind: "text", path: "refs.bib" },
      ], "main.md");
    } else {
      await app.openFileWithContent("refs.bib", bib);
      await app.openFileWithContent("main.md", main);
    }
    app.setMode("lexical");
  }, { bib: BIB, main: MAIN });
  await page.waitForFunction(
    (expected) => window.__editor?.getDoc?.() === expected,
    MAIN,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => Boolean(
      document.querySelector("[data-coflat-citation='true']")
      && document.querySelector(".cf-bibliography-entry"),
    ),
    undefined,
    { timeout: 15000 },
  );
  await waitForBrowserSettled(page);
}

async function readCitationInlineState(page) {
  return page.evaluate(() => {
    const citation = document.querySelector("[data-coflat-citation='true']");
    const editor = document.querySelector('[data-testid="lexical-editor"]');
    const walker = editor ? document.createTreeWalker(editor, NodeFilter.SHOW_TEXT) : null;
    let text = walker?.nextNode() ?? null;
    while (text && !(text.textContent ?? "").includes(" after citation.")) {
      text = walker?.nextNode() ?? null;
    }
    const citationRect = citation?.getBoundingClientRect();
    let afterRect = null;
    if (text) {
      const textContent = text.textContent ?? "";
      const start = textContent.indexOf(" after citation.");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + " after".length);
      afterRect = range.getBoundingClientRect();
    }
    return {
      citationAfterSameLine: citationRect && afterRect
        ? Math.abs(citationRect.top - afterRect.top) < citationRect.height
        : false,
      citationText: citation?.textContent ?? "",
    };
  });
}

export async function run(page) {
  await setRevealPresentation(page, "inline");
  await openReferenceFixture(page);

  const renderedState = await page.evaluate(() => {
    const citation = document.querySelector("[data-coflat-citation='true']");
    const citationStyle = citation ? getComputedStyle(citation) : null;
    const proofHeader = document.querySelector(".cf-lexical-block--proof .cf-lexical-block-header");
    const leftMargin = document.querySelector(".cf-bibliography-entry-content .csl-left-margin");
    const rightInline = document.querySelector(".cf-bibliography-entry-content .csl-right-inline");
    const leftRect = leftMargin?.getBoundingClientRect();
    const rightRect = rightInline?.getBoundingClientRect();

    return {
      bibliographyHasMath: Boolean(document.querySelector(".cf-bibliography-entry .katex")),
      bibliographyHtml: document.querySelector(".cf-bibliography-entry")?.innerHTML ?? "",
      bibliographyNumberSameLine: !leftRect || !rightRect
        ? true
        : Math.abs(leftRect.top - rightRect.top) < 2,
      citationText: citation?.textContent ?? "",
      proofHeaderText: proofHeader?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      referenceTextDecorationLine: citationStyle?.textDecorationLine ?? "",
    };
  });

  if (
    renderedState.proofHeaderText !== "Proof"
    || !renderedState.citationText.includes("[1]")
    || renderedState.referenceTextDecorationLine !== "none"
    || !renderedState.bibliographyNumberSameLine
    || !renderedState.bibliographyHasMath
  ) {
    return {
      pass: false,
      message: `reference/proof rendering regression: ${JSON.stringify(renderedState)}`,
    };
  }

  await page.waitForFunction(
    () => document.querySelector("[data-preview-state='error']")?.textContent?.includes("missing-preview.png"),
    undefined,
    { timeout: 5000 },
  );
  const missingMediaState = await page.evaluate(() => {
    const fallback = [...document.querySelectorAll("[data-preview-state='error']")]
      .find((element) => element.textContent?.includes("missing-preview.png"));
    return {
      hasFallback: Boolean(fallback),
      hasBrokenImage: Boolean([...document.querySelectorAll("img")]
        .some((image) => image instanceof HTMLImageElement && image.currentSrc.includes("missing-preview.png"))),
      text: fallback?.textContent ?? "",
    };
  });
  if (!missingMediaState.hasFallback || missingMediaState.hasBrokenImage) {
    return {
      pass: false,
      message: `missing PNG did not render as a local unavailable preview: ${JSON.stringify(missingMediaState)}`,
    };
  }

  await page.locator("[data-coflat-citation='true']").first().hover();
  await page.waitForFunction(
    () => Boolean(document.querySelector(".cf-hover-preview-tooltip[data-visible='true']")),
    undefined,
    { timeout: 5000 },
  );
  const hoverPreviewState = await page.evaluate(() => {
    const tooltip = document.querySelector(".cf-hover-preview-tooltip[data-visible='true']");
    if (!(tooltip instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(tooltip);
    const rect = tooltip.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      hitInsideTooltip: Boolean(hit && tooltip.contains(hit)),
      pointerEvents: style.pointerEvents,
    };
  });
  if (!hoverPreviewState?.hitInsideTooltip || hoverPreviewState.pointerEvents !== "auto") {
    return {
      pass: false,
      message: `hover preview did not capture pointer events: ${JSON.stringify(hoverPreviewState)}`,
    };
  }
  await page.mouse.move(hoverPreviewState.centerX, hoverPreviewState.centerY);
  await page.waitForFunction(
    () => !document.querySelector(".cf-hover-preview-tooltip[data-visible='true']"),
    undefined,
    { timeout: 5000 },
  );

  const clusteredCitationItem = page.locator(".cf-lexical-reference [data-coflat-ref-id='secondref']").first();
  await clusteredCitationItem.hover();
  await page.waitForFunction(
    () => document.querySelector(".cf-hover-preview-tooltip[data-visible='true']")?.textContent?.includes("Second clustered citation"),
    undefined,
    { timeout: 5000 },
  );
  await page.mouse.move(10, 10);
  await page.waitForTimeout(150);

  const inlineBeforeReveal = await readCitationInlineState(page);
  if (!inlineBeforeReveal.citationAfterSameLine) {
    return {
      pass: false,
      message: `citation rendered with a line break before reveal: ${JSON.stringify(inlineBeforeReveal)}`,
    };
  }

  await page.locator("[data-coflat-citation='true']").first().click({ force: true });
  await page.waitForFunction(
    () => window.getSelection()?.anchorNode?.textContent?.includes("@mathref"),
    undefined,
    { timeout: 5000 },
  );
  for (let index = 0; index < "[@mathref]".length + 2; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await waitForBrowserSettled(page);
  const inlineAfterReveal = await readCitationInlineState(page);
  if (!inlineAfterReveal.citationAfterSameLine || inlineAfterReveal.citationText !== "[1]") {
    return {
      pass: false,
      message: `citation reveal introduced a line break: ${JSON.stringify(inlineAfterReveal)}`,
    };
  }

  await page.locator('[data-testid="lexical-editor"] .cf-lexical-inline-math').first().click({ force: true });
  await page.waitForFunction(
    () => Boolean(document.querySelector(".cf-lexical-inline-reveal-preview-shell .katex")),
    undefined,
    { timeout: 5000 },
  );
  await waitForBrowserSettled(page);

  const revealState = await page.evaluate(() => {
    const shell = document.querySelector(".cf-lexical-inline-reveal-preview-shell");
    const portal = document.querySelector(".cf-lexical-inline-reveal-preview-portal");
    const sourceProbe = document.createElement("div");
    sourceProbe.className = "cf-lexical-editor cf-lexical-editor--source";
    sourceProbe.textContent = "$x$";
    sourceProbe.style.position = "absolute";
    sourceProbe.style.visibility = "hidden";
    document.body.append(sourceProbe);
    const sourceStyle = getComputedStyle(sourceProbe);

    const selectionNode = window.getSelection()?.anchorNode;
    const revealElement = selectionNode?.parentElement ?? null;
    const revealStyle = revealElement ? getComputedStyle(revealElement) : null;
    const shellStyle = shell ? getComputedStyle(shell) : null;
    const portalStyle = portal ? getComputedStyle(portal) : null;
    const rect = shell?.getBoundingClientRect();
    const hit = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null;
    const state = {
      boxShadow: shellStyle?.boxShadow ?? "",
      hitInsideChrome: Boolean(shell && hit && shell.contains(hit)),
      portalPointerEvents: portalStyle?.pointerEvents ?? "",
      sourceFontFamilyMatches: revealStyle?.fontFamily === sourceStyle.fontFamily,
      sourceFontSizeMatches: revealStyle?.fontSize === sourceStyle.fontSize,
    };
    sourceProbe.remove();
    return state;
  });

  if (
    revealState.boxShadow !== "none"
    || !revealState.hitInsideChrome
    || revealState.portalPointerEvents !== "auto"
    || !revealState.sourceFontFamilyMatches
    || !revealState.sourceFontSizeMatches
  ) {
    return {
      pass: false,
      message: `reveal chrome/source styling regression: ${JSON.stringify(revealState)}`,
    };
  }

  return { pass: true };
}
