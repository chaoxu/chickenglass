import {
  openFixtureDocument,
  switchToMode,
  withRuntimeIssueCapture,
} from "../test-helpers.mjs";

export const name = "mode-switch-no-flushsync-warning";
export const groups = ["app"];

const FIXTURE = {
  virtualPath: "mode-switch-flushsync.md",
  displayPath: "fixture:mode-switch-flushsync.md",
  content: `---
title: flushSync regression
---

# Heading

Some paragraph with inline $x^2$ math and [a link](https://example.com).

::: {.theorem #thm:a}
A theorem body.
:::
`,
};

export async function run(page) {
  await openFixtureDocument(page, FIXTURE, { mode: "lexical" });

  const { issues } = await withRuntimeIssueCapture(page, async () => {
    await switchToMode(page, "source");
    await switchToMode(page, "lexical");
    await switchToMode(page, "source");
    await switchToMode(page, "lexical");
  }, {
    ignoreConsole: [
      /Failed to load resource.*403/,
      /DevTools failed to load source map/,
    ],
  });

  const flushSyncIssues = issues.filter((issue) =>
    issue.text.includes("flushSync"));

  if (flushSyncIssues.length > 0) {
    const first = flushSyncIssues[0];
    return {
      pass: false,
      message: `mode switch produced ${flushSyncIssues.length} flushSync warning(s): ${first.text.substring(0, 160)}`,
    };
  }

  return {
    pass: true,
    message: "mode cycles did not emit flushSync lifecycle warnings",
  };
}
