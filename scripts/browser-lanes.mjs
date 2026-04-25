const CM6_RICH_FILTERS = [
  "block-widget-fence-guides",
  "block-widget-keyboard-access",
  "block-widget-shell-surface-geometry",
  "code-blocks",
  "cross-references",
  "fenced-divs",
  "heading-number-stability",
  "heading-outline-parity",
  "headings",
  "hover-preview-blocks",
  "index-open-rich-render",
  "inline-reveal-geometry",
  "math-render",
  "mode-switch-typing-parity",
  "rendered-hit-testing",
  "tables",
  "task-checkboxes",
  "visual-surface-parity",
];

const LEXICAL_FILTERS = [
  "heading-outline-parity",
  "lexical-bridge-insert-burst",
  "lexical-smoke",
  "mode-switch",
  "mode-switch-typing-parity",
  "rendered-hit-testing",
  "visual-surface-parity",
];

const MEDIA_FILTERS = [
  "hover-preview-blocks",
  "index-open-rich-render",
  "local-pdf-preview",
  "rendered-hit-testing",
];

const NAVIGATION_FILTERS = [
  "cursor-navigation",
  "display-math-vertical-handoff",
  "fenced-body-vertical-motion",
  "frontmatter-vertical-handoff",
  "nested-fenced-vertical-motion",
  "table-vertical-handoff",
  "wrapped-paragraph-vertical-motion",
];

const SCROLL_FILTERS = [
  "rankdecrease-arrowdown-sweep",
  "rankdecrease-proposition-proof-arrowdown-after-sweep",
  "rankdecrease-proposition-proof-arrowdown",
  "rich-arrowdown-bounded-scroll",
  "scroll-jump-rankdecrease",
  "scroll-stability",
  "whole-document-arrowdown-sweep",
];

const SMOKE_FILTERS = ["mode-switch", "index-open-rich-render", "headings", "math-render"];

export const BROWSER_HARNESS_SUPPORT_PATHS = [
  "scripts/browser-doctor.mjs",
  "scripts/browser-failure-artifacts.mjs",
  "scripts/browser-health.mjs",
  "scripts/browser-inspect.mjs",
  "scripts/browser-lane.mjs",
  "scripts/browser-lane.test.mjs",
  "scripts/browser-lanes.mjs",
  "scripts/browser-run-manifest.mjs",
  "scripts/browser-lifecycle.mjs",
  "scripts/browser-repro.mjs",
  "scripts/browser-screenshot.mjs",
  "scripts/document-surface-selector-contracts.mjs",
  "scripts/chrome-common.mjs",
  "scripts/devx-browser-session.mjs",
  "scripts/document-surface-parity.mjs",
  "scripts/editor-test-helpers.mjs",
  "scripts/fixture-test-helpers.mjs",
  "scripts/launch-chrome.mjs",
  "scripts/regression-runner-checks.mjs",
  "scripts/runtime-budget-profiles.mjs",
  "scripts/test-regression.mjs",
  "scripts/test-helpers.mjs",
  "scripts/typing-latency-helpers.mjs",
];

export const DOCUMENT_SURFACE_PARITY_PATH_PREFIXES = [
  "src/document-surface-classes.ts",
  "src/document-surfaces",
  "src/editor-theme.css",
  "src/render/block-render.ts",
  "src/render/decoration-core.ts",
  "src/render/markdown-render.ts",
  "src/render/plugin-render.ts",
  "src/render/preview-block-renderer.ts",
  "src/lexical/editor-theme.css",
  "src/lexical/markdown-schema.ts",
  "src/lexical/markdown/rich-html-preview.ts",
  "src/lexical/renderers/",
  "scripts/document-surface-parity.mjs",
  "scripts/document-surface-selector-contracts.mjs",
  "scripts/regression-tests/visual-surface-parity.mjs",
];

function filterArgs(filters) {
  return ["--filter", filters.join(",")];
}

export const BROWSER_LANES = {
  all: {
    args: [],
    description: "Full browser regression suite",
    filters: [],
  },
  "cm6-rich": {
    args: filterArgs(CM6_RICH_FILTERS),
    description: "CM6 rich rendering and rendered-surface editing lane",
    filters: CM6_RICH_FILTERS,
  },
  lexical: {
    args: filterArgs(LEXICAL_FILTERS),
    description: "Lexical WYSIWYG and mode-switch lane",
    filters: LEXICAL_FILTERS,
  },
  media: {
    args: filterArgs(MEDIA_FILTERS),
    description: "Image/PDF preview and media authoring lane",
    filters: MEDIA_FILTERS,
  },
  navigation: {
    args: filterArgs(NAVIGATION_FILTERS),
    description: "Keyboard navigation and vertical handoff lane",
    filters: NAVIGATION_FILTERS,
  },
  render: {
    args: filterArgs(["headings", "math-render", "index-open-rich-render"]),
    description: "Compatibility alias for the older CM6 render smoke lane",
    filters: ["headings", "math-render", "index-open-rich-render"],
  },
  parity: {
    args: [],
    description: "CM6/Lexical shared document-surface parity audit",
    filters: [],
    script: "scripts/document-surface-parity.mjs",
  },
  scroll: {
    args: filterArgs(SCROLL_FILTERS),
    description: "Long-document scroll and ArrowDown lane",
    filters: SCROLL_FILTERS,
  },
  smoke: {
    args: ["--scenario", "smoke"],
    description: "Merged-app smoke lane",
    filters: SMOKE_FILTERS,
  },
};

export const BROWSER_LANE_ORDER = [
  "smoke",
  "cm6-rich",
  "lexical",
  "media",
  "navigation",
  "scroll",
  "render",
  "parity",
  "all",
];

function hasPathPrefix(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

function includesAny(path, fragments) {
  return fragments.some((fragment) => path.includes(fragment));
}

function addLane(lanes, lane) {
  if (!lanes.includes(lane)) {
    lanes.push(lane);
  }
}

function regressionTestName(path) {
  const match = /^scripts\/regression-tests\/([^/]+)\.mjs$/.exec(path);
  return match?.[1] ?? "";
}

export function isBrowserHarnessSupportPath(path) {
  const normalizedPath = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return BROWSER_HARNESS_SUPPORT_PATHS.includes(normalizedPath);
}

export function resolveBrowserLane(name) {
  const lane = BROWSER_LANES[name];
  if (!lane) {
    throw new Error(`Unknown browser lane: ${name}`);
  }
  return { lane, name };
}

export function browserAreaTouched(paths) {
  return paths.some((path) =>
    path.startsWith("src/editor/") ||
    path.startsWith("src/parser/") ||
    path.startsWith("src/plugins/") ||
    path.startsWith("src/render/") ||
    path.startsWith("src/lexical/") ||
    path.startsWith("src/app/components/") ||
    path.startsWith("scripts/regression-tests/") ||
    isBrowserHarnessSupportPath(path)
  );
}

export function selectBrowserLanesForChangedFiles(paths, { profile = "quick" } = {}) {
  const lanes = [];
  const normalizedPaths = paths.map((path) => path.replaceAll("\\", "/").replace(/^\.\//, ""));

  const browserHarnessTouched = normalizedPaths.some(isBrowserHarnessSupportPath);
  if (browserHarnessTouched) {
    addLane(lanes, profile === "full" ? "all" : "smoke");
  }

  for (const path of normalizedPaths) {
    const testName = regressionTestName(path);

    if (
      path.startsWith("src/lexical/") ||
      path.startsWith("src/app/components/lexical-") ||
      testName.startsWith("lexical-")
    ) {
      addLane(lanes, "lexical");
    }

    if (
      hasPathPrefix(path, [
        "src/editor/image-",
        "src/lib/markdown-image.ts",
        "src/lib/markdown/image-targets",
        "src/lib/pdf-target.ts",
        "src/render/hover-preview",
        "src/render/image-",
        "src/render/media-preview",
        "src/render/pdf-",
        "src/state/image-url.ts",
        "src/state/local-media.ts",
        "src/state/markdown-image.ts",
        "src/state/media-index",
        "src/state/pdf-preview.ts",
      ]) ||
      includesAny(testName, ["hover-preview", "hit-testing", "pdf-preview"])
    ) {
      addLane(lanes, "media");
    }

    if (
      includesAny(path, ["scroll", "arrowdown", "rankdecrease"]) ||
      includesAny(testName, ["scroll", "arrowdown", "rankdecrease"])
    ) {
      addLane(lanes, "scroll");
    }

    if (
      includesAny(path, ["vertical", "cursor", "motion", "navigation"]) ||
      includesAny(testName, ["vertical", "cursor", "motion", "navigation"]) ||
      path.startsWith("src/editor/keymap") ||
      path.startsWith("src/editor/motion")
    ) {
      addLane(lanes, "navigation");
    }

    if (
      hasPathPrefix(path, [
        "src/document-surface-classes.ts",
        "src/document-surfaces",
        "src/editor/",
        "src/editor-theme.css",
        "src/parser/",
        "src/plugins/",
        "src/render/",
        "src/lexical/editor-theme.css",
        "src/lexical/markdown-schema.ts",
        "scripts/regression-tests/",
      ])
    ) {
      addLane(lanes, "cm6-rich");
    }

    if (
      hasPathPrefix(path, DOCUMENT_SURFACE_PARITY_PATH_PREFIXES) ||
      includesAny(testName, ["parity"])
    ) {
      addLane(lanes, "parity");
    }
  }

  if (lanes.includes("all")) {
    return ["all"];
  }
  return BROWSER_LANE_ORDER.filter((lane) => lanes.includes(lane) && lane !== "all" && lane !== "render");
}
