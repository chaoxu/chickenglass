import {
  openFixtureDocument,
  readEditorText,
  waitForBrowserSettled,
} from "../test-helpers.mjs";

export const name = "nested-blank-click-selection";
export const groups = ["navigation"];

const DOC = `::: {.theorem} Test
Alpha

Omega
:::
`;

const MARKER = "BlankClickNeedle";

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(details ? `${message}: ${JSON.stringify(details)}` : message);
  }
}

async function locateNestedBlankParagraph(page) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector(".cf-lexical-nested-editor--block-body");
      if (!(root instanceof HTMLElement)) return false;
      const paragraphs = [...root.querySelectorAll(".cf-lexical-paragraph")];
      return paragraphs.some((paragraph) => (paragraph.textContent ?? "").includes("Alpha")) &&
        paragraphs.some((paragraph) => (paragraph.textContent ?? "").includes("Omega")) &&
        paragraphs.some((paragraph) => (paragraph.textContent ?? "").trim() === "");
    },
    undefined,
    { timeout: 5000 },
  );

  return page.evaluate(() => {
    const root = document.querySelector(".cf-lexical-nested-editor--block-body");
    if (!(root instanceof HTMLElement)) return null;

    const paragraphs = [...root.querySelectorAll(".cf-lexical-paragraph")];
    const alpha = paragraphs.find((paragraph) => (paragraph.textContent ?? "").includes("Alpha"));
    const omega = paragraphs.find((paragraph) => (paragraph.textContent ?? "").includes("Omega"));
    const blank = paragraphs.find((paragraph) => (paragraph.textContent ?? "").trim() === "");
    if (!(alpha instanceof HTMLElement) || !(omega instanceof HTMLElement) || !(blank instanceof HTMLElement)) {
      return null;
    }

    root.scrollIntoView({ block: "center", inline: "nearest" });
    const rootRect = root.getBoundingClientRect();
    const alphaRect = alpha.getBoundingClientRect();
    const omegaRect = omega.getBoundingClientRect();
    const blankRect = blank.getBoundingClientRect();
    const y = blankRect.height > 0
      ? blankRect.top + blankRect.height / 2
      : (alphaRect.bottom + omegaRect.top) / 2;

    return {
      x: Math.round(rootRect.left + Math.min(32, Math.max(8, rootRect.width / 4))),
      y: Math.round(y),
    };
  });
}

export async function run(page) {
  await openFixtureDocument(page, {
    content: DOC,
    displayPath: "fixture:nested-blank-click.md",
    virtualPath: `scratch-blank-click-${Date.now()}.md`,
  }, { mode: "lexical" });
  const openedText = await readEditorText(page);
  assert(openedText.includes("Alpha") && openedText.includes("Omega"), "nested blank-click fixture did not open", {
    openedText,
  });

  const point = await locateNestedBlankParagraph(page);
  assert(point, "could not locate the nested blank paragraph click target");

  await page.mouse.click(point.x, point.y);
  await waitForBrowserSettled(page, 3);
  await page.keyboard.type(MARKER);
  await page.waitForFunction(
    (marker) => window.__editor?.getDoc?.().includes(marker),
    MARKER,
    { timeout: 5000 },
  );

  const editedText = await readEditorText(page);
  const alphaIndex = editedText.indexOf("Alpha");
  const markerIndex = editedText.indexOf(MARKER);
  const omegaIndex = editedText.indexOf("Omega");
  assert(
    alphaIndex !== -1 && markerIndex !== -1 && omegaIndex !== -1 &&
      alphaIndex < markerIndex && markerIndex < omegaIndex,
    "blank-click insertion did not stay inside the nested theorem body",
    { editedText, alphaIndex, markerIndex, omegaIndex },
  );
  assert(
    editedText.includes(`Alpha\n${MARKER}\nOmega`),
    "blank-click insertion did not preserve the nested body line position",
    { editedText },
  );

  return {
    pass: true,
    message: "mouse click in nested blank theorem paragraph inserts at that paragraph",
  };
}
