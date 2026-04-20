import { openRegressionDocument } from "../test-helpers.mjs";

export const name = "code-blocks";
export const groups = ["surfaces"];

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const initialState = await page.evaluate(() => {
    const body = document.querySelector(".cf-codeblock-body.cf-lexical-code-block");
    const button = document.querySelector(".cf-codeblock-copy");
    const label = document.querySelector(".cf-codeblock-language");
    return {
      hasButton: Boolean(button),
      hasBody: Boolean(body),
      language: label?.textContent?.trim() ?? null,
    };
  });

  if (!initialState.hasButton || !initialState.hasBody || !initialState.language) {
    return { pass: false, message: "code block chrome did not render language/copy affordances" };
  }

  const highlightState = await page.evaluate(() => {
    const codeBlocks = [...document.querySelectorAll(".cf-lexical-code-block")];
    const typescriptBlock = codeBlocks.find((element) =>
      element.textContent?.includes("const clickMappingLines = ["));

    if (!(typescriptBlock instanceof HTMLElement)) {
      return {
        found: false,
        hasHighlightLanguage: false,
        tokenClasses: [],
      };
    }

    const tokenClasses = [...typescriptBlock.querySelectorAll("[class*='cf-lexical-code-token--']")]
      .flatMap((element) => [...element.classList])
      .filter((className) => className.startsWith("cf-lexical-code-token--"));

    return {
      found: true,
      hasHighlightLanguage: typescriptBlock.hasAttribute("data-highlight-language"),
      tokenClasses,
    };
  });

  if (
    !highlightState.found
    || !highlightState.hasHighlightLanguage
    || !highlightState.tokenClasses.includes("cf-lexical-code-token--keyword")
    || !highlightState.tokenClasses.includes("cf-lexical-code-token--string")
  ) {
    return { pass: false, message: "code block syntax highlighting did not render token classes" };
  }

  const copied = await page.evaluate(async () => {
    const writes = [];
    const originalClipboard = navigator.clipboard;
    const clipboard = {
      ...originalClipboard,
      writeText: async (text) => {
        writes.push(text);
      },
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });

    const button = document.querySelector(".cf-codeblock-copy");
    if (!(button instanceof HTMLButtonElement)) {
      return { ok: false, writes };
    }

    button.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });

    return {
      ok: true,
      writes,
      label: button.textContent ?? "",
    };
  });

  if (!copied.ok || copied.writes.length === 0 || !copied.writes[0]?.includes("fibonacci :: Int -> Int")) {
    return { pass: false, message: "code block copy button did not write the block contents" };
  }

  if (copied.label.trim() !== "Copied") {
    return { pass: false, message: "code block copy button did not acknowledge the copy action" };
  }

  return {
    pass: true,
    message: `code block chrome rendered with ${initialState.language ?? "unknown"} label, syntax tokens, and a working copy button`,
  };
}
