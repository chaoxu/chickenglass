export const BROWSER_TEST_GROUPS = {
  app: [
    "list-marker-strip-on-continuation",
    "mode-switch-no-flushsync-warning",
    "mode-switch-preserves-doc",
    "save-flow",
    "search-mode-awareness",
  ],
  authoring: [
    "authoring-surfaces",
    "format-command",
    "reference-autocomplete",
    "undo-bridge",
  ],
  core: [
    "lexical-smoke",
    "cursor-reveal-edge-cases",
    "math-editing",
    "block-insert-focus",
    "block-widget-keyboard-access",
    "rich-surface-overlays",
    "rich-surface-parity",
    "index-wysiwyg-parity",
  ],
  index: [
    "cross-references",
    "footnotes",
    "headings",
    "index-media-surface",
    "index-structure-parity",
    "index-wysiwyg-parity",
    "reference-preview-citations",
  ],
  navigation: [
    "block-insert-focus",
    "block-widget-keyboard-access",
    "focus-command-surfaces",
    "nested-blank-click-selection",
    "source-rich-nested-offsets",
    "undo-bridge",
  ],
  reveal: [
    "cursor-reveal",
    "cursor-reveal-edge-cases",
    "inline-format-editing",
    "inline-token-source-offsets",
    "math-editing",
    "paragraph-reveal",
    "reveal-no-trigger-after-markdown-transform",
    "table-inline-math-keyboard-reveal",
  ],
  smoke: [
    "lexical-smoke",
  ],
  surfaces: [
    "active-nested-source-switch",
    "authoring-surfaces",
    "code-blocks",
    "embedded-field-dirty-state",
    "include-composition",
    "nested-rich-editing",
    "rich-surface-overlays",
    "rich-surface-parity",
    "tables",
    "source-rich-nested-offsets",
  ],
};

function splitCsv(value) {
  return value
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

export function expandBrowserTestSelection({
  availableTestNames,
  filterArg = "",
  groupArg = "",
}) {
  const available = new Set(availableTestNames);
  const requested = new Set();
  const unknownGroups = [];
  const unknownTests = [];

  for (const groupName of splitCsv(groupArg)) {
    const groupTests = BROWSER_TEST_GROUPS[groupName];
    if (!groupTests) {
      unknownGroups.push(groupName);
      continue;
    }
    for (const testName of groupTests) {
      requested.add(testName);
    }
  }

  for (const testName of splitCsv(filterArg)) {
    requested.add(testName);
  }

  if (requested.size === 0) {
    return {
      selected: availableTestNames,
      unknownGroups,
      unknownTests,
    };
  }

  const selected = [];
  for (const testName of requested) {
    if (available.has(testName)) {
      selected.push(testName);
    } else {
      unknownTests.push(testName);
    }
  }

  return {
    selected,
    unknownGroups,
    unknownTests,
  };
}

export function formatBrowserTestList(tests) {
  const lines = ["Available browser regression tests:"];
  for (const test of tests) {
    lines.push(`  ${test.name}`);
  }

  lines.push("", "Groups:");
  for (const [name, testNames] of Object.entries(BROWSER_TEST_GROUPS)) {
    lines.push(`  ${name}: ${testNames.join(", ")}`);
  }
  return lines.join("\n");
}
