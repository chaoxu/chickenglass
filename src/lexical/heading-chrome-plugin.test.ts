import { describe, expect, it } from "vitest";

import { syncHeadingChrome } from "./heading-chrome-plugin";

describe("syncHeadingChrome", () => {
  it("does not number unnumbered headings when non-document headings are present", () => {
    document.body.innerHTML = `
      <div id="root">
        <h1 class="cf-lexical-heading">Intro</h1>
        <h2 class="cf-bibliography-heading">References</h2>
        <h2 class="cf-lexical-heading">Aside {-}</h2>
        <h2 class="cf-lexical-heading">Methods</h2>
      </div>
    `;
    const root = document.getElementById("root");
    if (!(root instanceof HTMLElement)) {
      throw new Error("missing root");
    }

    syncHeadingChrome(root, [
      "# Intro",
      "",
      "## Aside {-}",
      "",
      "## Methods",
    ].join("\n"));

    const headings = [...root.querySelectorAll<HTMLElement>(".cf-lexical-heading")];
    expect(headings[0].dataset.coflatHeadingNumber).toBe("1");
    expect(headings[1].dataset.coflatHeadingNumber).toBeUndefined();
    expect(headings[2].dataset.coflatHeadingNumber).toBe("1.1");
  });

  it("leaves heading text content untouched (issue #98)", () => {
    // Regression: mutating the rendered text of a Lexical heading (to hide the
    // Pandoc attribute suffix) caused Lexical's MutationObserver to push the
    // stripped text back into state on the next keystroke, silently dropping
    // authored `{-}` / `{.unnumbered}` / `{#id}` blocks.
    document.body.innerHTML = `
      <div id="root">
        <h1 class="cf-lexical-heading">Appendix {-}</h1>
        <h2 class="cf-lexical-heading">Methods {.unnumbered}</h2>
        <h3 class="cf-lexical-heading">Notes {#sec:notes}</h3>
      </div>
    `;
    const root = document.getElementById("root");
    if (!(root instanceof HTMLElement)) {
      throw new Error("missing root");
    }

    syncHeadingChrome(root, [
      "# Appendix {-}",
      "",
      "## Methods {.unnumbered}",
      "",
      "### Notes {#sec:notes}",
    ].join("\n"));

    const headings = [...root.querySelectorAll<HTMLElement>(".cf-lexical-heading")];
    expect(headings[0].textContent).toBe("Appendix {-}");
    expect(headings[1].textContent).toBe("Methods {.unnumbered}");
    expect(headings[2].textContent).toBe("Notes {#sec:notes}");
  });
});
