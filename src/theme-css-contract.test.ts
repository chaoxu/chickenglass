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

describe("theme CSS contract", () => {
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
  });

  it("owns critical CM6 layout CSS statically", () => {
    const css = readRepoFile("src/editor-theme.css");

    expect(cssRuleBody(css, ".cm-editor")).toContain("display: flex !important;");
    expect(cssRuleBody(css, ".cm-scroller")).toContain("display: flex !important;");
    expect(cssRuleBody(css, ".cm-scroller")).toContain("overflow: auto;");
    expect(cssRuleBody(css, ".cm-content")).toContain("min-height: 100%;");
    expect(cssRuleBody(css, ".cm-content")).toContain("white-space: pre;");
  });
});
