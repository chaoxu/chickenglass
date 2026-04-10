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
    expect(headings[1].textContent).toBe("Aside");
    expect(headings[2].dataset.coflatHeadingNumber).toBe("1.1");
  });
});
