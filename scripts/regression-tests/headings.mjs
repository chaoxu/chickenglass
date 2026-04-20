import { openAndSettleRegressionDocument, waitForBrowserSettled } from "../test-helpers.mjs";

export const name = "headings";
export const groups = ["index"];

const BREADCRUMB_REPRO = [
  "---",
  "title: Breadcrumb Repro",
  "---",
  "",
  "Intro paragraph before the first heading.",
  "",
  "# First",
  "",
  ...Array.from({ length: 36 }, (_, index) => `Filler paragraph ${index + 1}.`),
  "",
  "## Second",
  "",
  ...Array.from({ length: 36 }, (_, index) => `More filler paragraph ${index + 1}.`),
  "",
].join("\n\n");

async function verifyBreadcrumbScrollViewport(page) {
  await page.evaluate(async (doc) => {
    const app = window.__app;
    if (app.closeFile) {
      try {
        await app.closeFile({ discard: true });
      } catch {
        // Ignore stale cleanup between cases.
      }
    }
    app.setMode("lexical");
    await app.openFileWithContent("breadcrumb-repro.md", doc);
    app.setMode("lexical");
  }, BREADCRUMB_REPRO);

  await page.waitForFunction(
    () => document.querySelectorAll(".cf-lexical-heading").length >= 2,
    undefined,
    { timeout: 10000 },
  );

  const scrollState = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const surface = document.querySelector(".cf-lexical-surface--scroll");
    const firstHeading = document.querySelector(".cf-lexical-heading");
    if (!(surface instanceof HTMLElement) || !(firstHeading instanceof HTMLElement)) {
      return { error: "missing scroll surface or heading" };
    }

    surface.scrollTop = Math.max(180, firstHeading.offsetTop + 80);
    surface.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(160);

    const breadcrumb = document.querySelector(".cf-breadcrumbs");
    const surfaceRect = surface.getBoundingClientRect();
    const rootRect = document.querySelector("[data-testid='lexical-editor']")?.getBoundingClientRect();
    const headingRect = firstHeading.getBoundingClientRect();

    return {
      breadcrumbClass: breadcrumb?.className ?? "",
      breadcrumbText: breadcrumb?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      headingTop: headingRect.top,
      rootTop: rootRect?.top ?? null,
      scrollTop: surface.scrollTop,
      surfaceTop: surfaceRect.top,
    };
  });

  if (scrollState.error) {
    return { pass: false, message: scrollState.error };
  }

  if (!scrollState.breadcrumbText.includes("First")) {
    return {
      pass: false,
      message: `breadcrumb did not track the scrolled surface viewport: ${JSON.stringify(scrollState)}`,
    };
  }

  return { pass: true };
}

export async function run(page) {
  await openAndSettleRegressionDocument(page, "index.md");

  const state = await page.evaluate(() => ({
    headingCount: document.querySelectorAll(".cf-lexical-heading").length,
    sectionNumbers: [...document.querySelectorAll("[data-section-number]")]
      .map((el) => el.getAttribute("data-section-number"))
      .filter(Boolean),
    tree: window.__cmDebug?.treeString?.() ?? "",
  }));

  if (!state.tree.includes("(heading)")) {
    return { pass: false, message: "debug tree did not report any headings" };
  }

  if (state.headingCount === 0) {
    return { pass: false, message: "rich mode did not render any heading surfaces" };
  }

  const breadcrumbResult = await verifyBreadcrumbScrollViewport(page);
  if (!breadcrumbResult.pass) {
    return breadcrumbResult;
  }
  await waitForBrowserSettled(page);

  return {
    pass: true,
    message: `${state.headingCount} headings rendered${state.sectionNumbers.length > 0 ? ` (${state.sectionNumbers.join(", ")})` : ""}; breadcrumbs track scroll viewport`,
  };
}
