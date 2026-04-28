import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function cssRuleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) {
    throw new Error(`expected CSS rule for ${selector}`);
  }
  return match[1];
}

function cssCustomProperties(ruleBody: string): string[] {
  return [...ruleBody.matchAll(/--cf-[\w-]+\s*:/g)].map((match) =>
    match[0].slice(0, -1).trim()
  );
}

describe("theme CSS contract", () => {
  it("keeps dark mode as a complete token set", () => {
    const css = readRepoFile("src/editor-theme.css");
    const rootTokens = cssCustomProperties(cssRuleBody(css, ":root"));
    const darkTokens = new Set(cssCustomProperties(cssRuleBody(css, "[data-theme=\"dark\"]")));

    expect(rootTokens.filter((token) => !darkTokens.has(token))).toEqual([]);
  });

  it("keeps preview and citation hover surfaces on shared foreground tokens", () => {
    const css = readRepoFile("src/editor-theme.css");

    expect(cssRuleBody(css, ".cf-preview-surface-body")).toContain(
      "color: var(--cf-fg);",
    );
    expect(cssRuleBody(css, ".cf-hover-preview-citation")).toContain(
      "color: var(--cf-fg);",
    );
    expect(cssRuleBody(css, ".cf-hover-preview-unresolved")).toContain(
      "color: var(--cf-muted);",
    );
    expect(cssRuleBody(css, ".cf-shell-surface-label")).toContain(
      "color: var(--cf-bg);",
    );
    expect(cssRuleBody(readRepoFile("src/lexical/editor-theme.css"), ".cf-lexical-media-object")).toContain(
      "background: var(--cf-bg);",
    );
  });

  it("owns critical CM6 layout CSS statically", () => {
    const css = readRepoFile("src/editor-theme.css");

    expect(cssRuleBody(css, ".cm-editor")).toContain("display: flex !important;");
    expect(cssRuleBody(css, ".cm-scroller")).toContain("display: flex !important;");
    expect(cssRuleBody(css, ".cm-scroller")).toContain("overflow: auto;");
    expect(cssRuleBody(css, ".cm-content")).toContain(
      "max-width: var(--cf-content-max-width, 800px);",
    );
    expect(cssRuleBody(css, ".cm-content")).toContain("margin-left: auto;");
    expect(cssRuleBody(css, ".cm-content")).toContain(
      "margin-right: max(var(--cf-sidenote-width, 224px), calc((100% - var(--cf-content-max-width, 800px)) / 2));",
    );
    expect(cssRuleBody(css, ".cm-content")).toContain("min-height: 100%;");
    expect(cssRuleBody(css, ".cm-content")).toContain(
      "padding: var(--cf-doc-content-padding-block-start, 24px) var(--cf-doc-content-padding-inline, 48px) var(--cf-doc-content-padding-block-end, 24px) var(--cf-doc-content-padding-inline, 48px);",
    );
    expect(cssRuleBody(css, ".cm-content")).toContain("white-space: pre;");
  });
});
