import {
  formatRuntimeIssues,
  openRegressionDocument,
  readEditorText,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "inline-format-editing";

const UPDATED_ITALIC = "*italic source edited*";
const UPDATED_BOLD = "**Bold source edited**";
const UPDATED_CODE = "`inline code edited`";
const LEFT_EXIT_MARKER = "LeftInlineExitNeedle";
const RIGHT_EXIT_MARKER = "RightInlineExitNeedle";

function getInlineDelimiterLengths(raw) {
  const delimiters = ["***", "**", "~~", "==", "*", "`"];
  for (const delimiter of delimiters) {
    if (raw.startsWith(delimiter) && raw.endsWith(delimiter) && raw.length >= delimiter.length * 2) {
      return {
        close: delimiter.length,
        open: delimiter.length,
      };
    }
  }
  return {
    close: 0,
    open: 0,
  };
}

function inlineToken(page, selector, text) {
  return page.locator(selector).filter({ hasText: text }).first();
}

function inlineSourceEditor(page) {
  return page.locator(".cf-lexical-inline-format-source").first();
}

async function selectAllInlineSource(page) {
  await page.evaluate(() => {
    const sourceElement = document.querySelector(".cf-lexical-inline-format-source");
    if (!(sourceElement instanceof HTMLElement)) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(sourceElement);
    selection.removeAllRanges();
    selection.addRange(range);
    const editor = sourceElement.closest("[contenteditable='true']");
    if (editor instanceof HTMLElement) {
      editor.focus();
    }
  });
}

async function typeIntoInlineSource(page, text) {
  const editor = inlineSourceEditor(page);
  await editor.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(100);
  await selectAllInlineSource(page);
  await page.keyboard.press("Backspace");

  let typed = "";
  for (const character of text) {
    await page.keyboard.type(character);
    await page.waitForTimeout(30);
    typed += character;
    const snapshot = await page.evaluate(() => {
      const sourceElement = document.querySelector(".cf-lexical-inline-format-source");
      if (!(sourceElement instanceof HTMLElement)) {
        return null;
      }
      const selection = window.getSelection();
      const caretOffset = (() => {
        if (!selection || !selection.isCollapsed || !selection.anchorNode || !sourceElement.contains(selection.anchorNode)) {
          return null;
        }
        if (selection.anchorNode instanceof Text) {
          return selection.anchorOffset;
        }
        const range = document.createRange();
        range.selectNodeContents(sourceElement);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        return range.toString().length;
      })();
      return {
        active: Boolean(selection?.anchorNode && sourceElement.contains(selection.anchorNode)),
        caretOffset,
        value: sourceElement.textContent ?? "",
      };
    });

    if (!snapshot) {
      throw new Error("inline format source input disappeared while typing");
    }
    if (!snapshot.active) {
      throw new Error(`inline format source lost focus while typing ${JSON.stringify(typed)}`);
    }
    if (snapshot.value !== typed) {
      throw new Error(`inline format source value drifted while typing ${JSON.stringify(typed)}`);
    }
    if (snapshot.caretOffset !== typed.length) {
      throw new Error(`inline format cursor jumped while typing ${JSON.stringify(typed)}`);
    }
  }
}

async function readInlineSourceState(page) {
  return page.evaluate(() => {
    const sourceElement = document.querySelector(".cf-lexical-inline-format-source");
    if (!(sourceElement instanceof HTMLElement)) {
      return null;
    }

    const editor = sourceElement.closest("[contenteditable='true']");
    const selection = window.getSelection();
    const caretOffset = (() => {
      if (!selection || !selection.isCollapsed || !selection.anchorNode || !sourceElement.contains(selection.anchorNode)) {
        return null;
      }
      if (selection.anchorNode instanceof Text) {
        return selection.anchorOffset;
      }
      const range = document.createRange();
      range.selectNodeContents(sourceElement);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      return range.toString().length;
    })();
    return {
      active: Boolean(selection?.anchorNode && sourceElement.contains(selection.anchorNode)),
      caretOffset,
      inEditorFlow: Boolean(editor),
      selectionEnd: caretOffset,
      selectionStart: caretOffset,
      value: sourceElement.textContent ?? "",
    };
  });
}

async function placeCaretAroundInlineToken(page, selector, text, side) {
  const placed = await page.evaluate(({ nextSelector, nextSide, nextText }) => {
    const anchor = [...document.querySelectorAll(nextSelector)].find((candidate) =>
      (candidate.textContent ?? "").includes(nextText)
    );
    if (!(anchor instanceof HTMLElement)) {
      return false;
    }

    const token = anchor.closest("code") ?? anchor;
    const parent = token.parentNode;
    const editor = token.closest("[contenteditable='true']");
    if (!(parent instanceof Node) || !(editor instanceof HTMLElement)) {
      return false;
    }

    const childNodes = [...parent.childNodes];
    const childIndex = childNodes.indexOf(token);
    if (childIndex < 0) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    const range = document.createRange();
    const adjacentNode = nextSide === "before"
      ? childNodes[childIndex - 1] ?? null
      : childNodes[childIndex + 1] ?? null;
    if (adjacentNode instanceof Text) {
      range.setStart(adjacentNode, nextSide === "before" ? adjacentNode.textContent?.length ?? 0 : 0);
    } else {
      range.setStart(parent, nextSide === "before" ? childIndex : childIndex + 1);
    }
    range.collapse(true);
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, {
    nextSelector: selector,
    nextSide: side,
    nextText: text,
  });

  if (!placed) {
    throw new Error(`failed to place the caret ${side} the inline token ${JSON.stringify(text)}`);
  }

  await page.waitForTimeout(200);
}

async function setInlineSourceCaret(page, position) {
  await page.evaluate((nextPosition) => {
    const sourceElement = document.querySelector(".cf-lexical-inline-format-source");
    if (!(sourceElement instanceof HTMLElement)) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const textNode = sourceElement.firstChild instanceof Text
      ? sourceElement.firstChild
      : document.createTextNode(sourceElement.textContent ?? "");
    if (!sourceElement.firstChild) {
      sourceElement.append(textNode);
    }
    const raw = textNode.textContent ?? "";
    const delimiters = (() => {
      const delimiterTokens = ["***", "**", "~~", "==", "*", "`"];
      for (const delimiter of delimiterTokens) {
        if (raw.startsWith(delimiter) && raw.endsWith(delimiter) && raw.length >= delimiter.length * 2) {
          return {
            close: delimiter.length,
            open: delimiter.length,
          };
        }
      }
      return {
        close: 0,
        open: 0,
      };
    })();
    const caret = nextPosition === "content-end"
      ? Math.max(0, raw.length - delimiters.close)
      : nextPosition === "content-start"
        ? delimiters.open
        : nextPosition === "end"
          ? raw.length
          : 0;
    const range = document.createRange();
    range.setStart(textNode, caret);
    range.collapse(true);
    const editor = sourceElement.closest("[contenteditable='true']");
    if (editor instanceof HTMLElement) {
      editor.focus();
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }, position);
  await page.waitForTimeout(100);
}

export async function run(page) {
  await openRegressionDocument(page, "index.md", { mode: "lexical" });

  const { issues, value } = await withRuntimeIssueCapture(page, async () => {
    await inlineToken(page, ".cf-italic", "italic text").click();
    const italicInput = inlineSourceEditor(page);
    await italicInput.waitFor({ state: "visible", timeout: 5000 });
    const initialItalic = await italicInput.textContent();
    const italicEditorState = await readInlineSourceState(page);

    await typeIntoInlineSource(page, UPDATED_ITALIC);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await inlineToken(page, ".cf-bold", "Bold text").click();
    const boldInput = inlineSourceEditor(page);
    await boldInput.waitFor({ state: "visible", timeout: 5000 });
    const initialBold = await boldInput.textContent();
    await typeIntoInlineSource(page, UPDATED_BOLD);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await inlineToken(page, ".cf-inline-code", "inline code").click();
    const codeInput = inlineSourceEditor(page);
    await codeInput.waitFor({ state: "visible", timeout: 5000 });
    const initialCode = await codeInput.textContent();
    await typeIntoInlineSource(page, UPDATED_CODE);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await inlineToken(page, ".cf-strikethrough", "strikethrough").click();
    const strikeInput = inlineSourceEditor(page);
    await strikeInput.waitFor({ state: "visible", timeout: 5000 });
    const initialStrike = await strikeInput.textContent();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    await inlineToken(page, ".cf-highlight", "highlight").click();
    const highlightInput = inlineSourceEditor(page);
    await highlightInput.waitFor({ state: "visible", timeout: 5000 });
    const initialHighlight = await highlightInput.textContent();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    await placeCaretAroundInlineToken(page, ".cf-italic", "italic source edited", "before");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    const entryFromLeft = await readInlineSourceState(page);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);

    await placeCaretAroundInlineToken(page, ".cf-italic", "italic source edited", "after");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    const entryFromRight = await readInlineSourceState(page);

    await setInlineSourceCaret(page, "end");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    await page.keyboard.type(RIGHT_EXIT_MARKER);
    await page.waitForTimeout(150);

    await placeCaretAroundInlineToken(page, ".cf-italic", "italic source edited", "before");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    await setInlineSourceCaret(page, "start");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(100);
    await page.keyboard.type(LEFT_EXIT_MARKER);
    await page.waitForTimeout(150);

    const markdown = await readEditorText(page);
    return {
      entryFromLeft,
      entryFromRight,
      initialBold,
      initialCode,
      initialHighlight,
      initialItalic,
      italicEditorState,
      initialStrike,
      markdown,
    };
  }, {
    ignoreConsole: ["[vite] connecting...", "[vite] connected."],
    ignorePageErrors: [
      /Cache storage is disabled because the context is sandboxed/,
    ],
  });

  if (issues.length > 0) {
    return {
      pass: false,
      message: `runtime issues surfaced during inline-format editing: ${formatRuntimeIssues(issues)}`,
    };
  }

  if (value.initialItalic !== "*italic text*") {
    return {
      pass: false,
      message: `italic source reveal opened ${JSON.stringify(value.initialItalic)} instead of raw markdown`,
    };
  }

  if (!value.italicEditorState?.inEditorFlow) {
    return {
      pass: false,
      message: "italic source reveal still opened outside the document flow instead of expanding in place",
    };
  }

  if (value.initialBold !== "**Bold text**") {
    return {
      pass: false,
      message: `bold source reveal opened ${JSON.stringify(value.initialBold)} instead of raw markdown`,
    };
  }

  if (value.initialCode !== "`inline code`") {
    return {
      pass: false,
      message: `inline code source reveal opened ${JSON.stringify(value.initialCode)} instead of raw markdown`,
    };
  }

  if (value.initialStrike !== "~~strikethrough~~") {
    return {
      pass: false,
      message: `strikethrough source reveal opened ${JSON.stringify(value.initialStrike)} instead of raw markdown`,
    };
  }

  if (value.initialHighlight !== "==highlight==") {
    return {
      pass: false,
      message: `highlight source reveal opened ${JSON.stringify(value.initialHighlight)} instead of raw markdown`,
    };
  }

  const entryFromLeftDelimiter = getInlineDelimiterLengths(value.entryFromLeft?.value ?? "");
  if (
    !value.entryFromLeft
    || value.entryFromLeft.selectionStart !== entryFromLeftDelimiter.open
    || value.entryFromLeft.selectionEnd !== entryFromLeftDelimiter.open
  ) {
    return {
      pass: false,
      message: "ArrowRight entry from the left did not open inline markdown editing at content start",
    };
  }

  if (!value.entryFromLeft.inEditorFlow) {
    return {
      pass: false,
      message: "ArrowRight entry opened inline markdown editing outside the document flow",
    };
  }

  const entryFromRightDelimiter = getInlineDelimiterLengths(value.entryFromRight?.value ?? "");
  const expectedRightCaret = value.entryFromRight
    ? value.entryFromRight.value.length - entryFromRightDelimiter.close
    : -1;
  if (
    !value.entryFromRight
    || value.entryFromRight.selectionStart !== expectedRightCaret
    || value.entryFromRight.selectionEnd !== expectedRightCaret
  ) {
    return {
      pass: false,
      message: "ArrowLeft entry from the right did not open inline markdown editing at content end",
    };
  }

  if (!value.entryFromRight.inEditorFlow) {
    return {
      pass: false,
      message: "ArrowLeft entry opened inline markdown editing outside the document flow",
    };
  }

  if (!value.markdown.includes(UPDATED_ITALIC)) {
    return {
      pass: false,
      message: "italic inline source edits did not flow back into canonical markdown",
    };
  }

  if (!value.markdown.includes(UPDATED_BOLD)) {
    return {
      pass: false,
      message: "bold inline source edits did not flow back into canonical markdown",
    };
  }

  if (!value.markdown.includes(UPDATED_CODE)) {
    return {
      pass: false,
      message: "inline code source edits did not flow back into canonical markdown",
    };
  }

  const leftMarkerIndex = value.markdown.indexOf(LEFT_EXIT_MARKER);
  const italicIndex = value.markdown.indexOf(UPDATED_ITALIC);
  const rightMarkerIndex = value.markdown.indexOf(RIGHT_EXIT_MARKER);
  if (
    leftMarkerIndex < 0
    || italicIndex < 0
    || rightMarkerIndex < 0
    || !(leftMarkerIndex < italicIndex && italicIndex < rightMarkerIndex)
  ) {
    return {
      pass: false,
      message: "inline markdown boundary exits did not return typing to the surrounding document",
    };
  }

  return {
    pass: true,
    message: "bold, italic, strike, highlight, and inline code reveal raw markdown on click/caret entry and keep typing stable",
  };
}
