#!/usr/bin/env node

import console from "node:console";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseChromeArgs } from "./chrome-common.mjs";
import {
  assertEditorHealth,
  clearStructure,
  connectEditor,
  createArgParser,
  disconnectBrowser,
  EXTERNAL_DEMO_ROOT,
  getGeometrySnapshot,
  openFixtureDocument,
  scrollTo,
  setCursor,
  settleEditorLayout,
  sleep,
  waitForDebugBridge,
} from "./test-helpers.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const FIXTURES = {
  rankdecrease: {
    displayPath: "demo/rankdecrease/main.md",
    virtualPath: "rankdecrease/main.md",
    candidates: [
      resolve(REPO_ROOT, "demo/rankdecrease/main.md"),
      resolve(EXTERNAL_DEMO_ROOT, "rankdecrease/main.md"),
    ],
    defaultLine: 900,
  },
  cogirth: {
    displayPath: "demo/cogirth/main2.md",
    virtualPath: "cogirth/main2.md",
    candidates: [
      resolve(REPO_ROOT, "demo/cogirth/main2.md"),
      resolve(EXTERNAL_DEMO_ROOT, "cogirth/main2.md"),
    ],
    defaultLine: 700,
  },
};

function printUsage() {
  console.log(`Usage:
  node scripts/geometry-audit.mjs [options]

Options:
  --fixture <rankdecrease|cogirth>   Fixture key (default: rankdecrease)
  --line <n>                         1-based anchor line for the audit
  --radius <n>                       Visible-line window radius (default: 3)
  --scenario <structure|focus|scroll> Scenario to run (default: structure)
  --browser <managed|cdp>            Browser lane (default: managed)
  --headed                           Show the Playwright-owned browser window
  --port <n>                         CDP port for Chrome for Testing
  --url <url>                        App URL Chrome is already running against
  --json                             Print JSON instead of a text report
`);
}

function compactLine(line) {
  return {
    line: line.line,
    top: Math.round(line.documentTop),
    height: Math.round(line.rect.height),
    classes: line.classes,
    text: line.text,
  };
}

function compactSurface(surface) {
  return {
    key: surface.key,
    label: surface.label,
    depth: surface.depth,
    rect: surface.rect
      ? {
          left: Math.round(surface.rect.left),
          top: Math.round(surface.rect.top),
          width: Math.round(surface.rect.width),
          height: Math.round(surface.rect.height),
        }
      : null,
    visibleTopLine: surface.visibleTopLine,
    visibleBottomLine: surface.visibleBottomLine,
    nodes: surface.nodes.length,
  };
}

function windowLines(snapshot, centerLine, radius) {
  return snapshot.visibleLines
    .filter((line) => Math.abs(line.line - centerLine) <= radius)
    .map(compactLine);
}

function lineMap(snapshot) {
  return new Map(snapshot.visibleLines.map((line) => [line.line, line]));
}

function diffLines(before, after, centerLine, radius) {
  const beforeMap = lineMap(before);
  const afterMap = lineMap(after);
  const result = [];
  for (let line = Math.max(1, centerLine - radius); line <= centerLine + radius; line += 1) {
    const left = beforeMap.get(line);
    const right = afterMap.get(line);
    if (!left || !right) {
      result.push({
        line,
        before: left ? compactLine(left) : null,
        after: right ? compactLine(right) : null,
      });
      continue;
    }
    result.push({
      line,
      topDelta: Math.round(right.documentTop - left.documentTop),
      heightDelta: Math.round(right.rect.height - left.rect.height),
      classesChanged: left.classes.join(" ") !== right.classes.join(" "),
      textChanged: left.text !== right.text,
      before: compactLine(left),
      after: compactLine(right),
    });
  }
  return result;
}

function summarizeSnapshot(label, snapshot, centerLine, radius) {
  return {
    label,
    scrollTop: snapshot.scrollTop,
    viewport: `L${snapshot.viewportFromLine}-L${snapshot.viewportToLine}`,
    lines: windowLines(snapshot, centerLine, radius),
    surfaces: snapshot.surfaces.map(compactSurface),
  };
}

async function takeSnapshot(page, label, centerLine, radius) {
  await settleEditorLayout(page, { frameCount: 3, delayMs: 48 });
  await sleep(80);
  const snapshot = await getGeometrySnapshot(page);
  return {
    raw: snapshot,
    summary: summarizeSnapshot(label, snapshot, centerLine, radius),
  };
}

async function blurEditor(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

async function focusEditor(page) {
  await page.evaluate(() => {
    window.__cmView.focus();
  });
}

async function runStructureScenario(page, line, radius) {
  await scrollTo(page, line);
  await setCursor(page, line, 0);
  const before = await takeSnapshot(page, "before", line, radius);
  const activated = await page.evaluate(() => window.__cmDebug.activateStructureAtCursor());
  const opened = await takeSnapshot(page, "opened", line, radius);
  await clearStructure(page);
  const closed = await takeSnapshot(page, "closed", line, radius);
  return {
    activated,
    snapshots: [before.summary, opened.summary, closed.summary],
    deltas: [
      { from: "before", to: "opened", lines: diffLines(before.raw, opened.raw, line, radius) },
      { from: "opened", to: "closed", lines: diffLines(opened.raw, closed.raw, line, radius) },
    ],
  };
}

async function runFocusScenario(page, line, radius) {
  await scrollTo(page, line);
  await setCursor(page, line, 0);
  const before = await takeSnapshot(page, "before", line, radius);
  await blurEditor(page);
  const blurred = await takeSnapshot(page, "blurred", line, radius);
  await focusEditor(page);
  await setCursor(page, line, 0);
  const refocused = await takeSnapshot(page, "refocused", line, radius);
  return {
    snapshots: [before.summary, blurred.summary, refocused.summary],
    deltas: [
      { from: "before", to: "blurred", lines: diffLines(before.raw, blurred.raw, line, radius) },
      { from: "blurred", to: "refocused", lines: diffLines(blurred.raw, refocused.raw, line, radius) },
    ],
  };
}

async function runScrollScenario(page, line, radius) {
  await scrollTo(page, line);
  const before = await takeSnapshot(page, "before", line, radius);
  await scrollTo(page, line + Math.max(radius * 8, 40));
  const scrolledAway = await takeSnapshot(page, "scrolled-away", line + Math.max(radius * 8, 40), radius);
  await scrollTo(page, line);
  const returned = await takeSnapshot(page, "returned", line, radius);
  return {
    snapshots: [before.summary, scrolledAway.summary, returned.summary],
    deltas: [
      { from: "before", to: "returned", lines: diffLines(before.raw, returned.raw, line, radius) },
    ],
  };
}

function formatLineDelta(lineDelta) {
  if (lineDelta.before === null || lineDelta.after === null) {
    return `  L${lineDelta.line}: before=${lineDelta.before ? "present" : "missing"} after=${lineDelta.after ? "present" : "missing"}`;
  }
  return `  L${lineDelta.line}: top ${lineDelta.before.top} -> ${lineDelta.after.top} (${lineDelta.topDelta >= 0 ? "+" : ""}${lineDelta.topDelta}), height ${lineDelta.before.height} -> ${lineDelta.after.height} (${lineDelta.heightDelta >= 0 ? "+" : ""}${lineDelta.heightDelta})`;
}

function formatReport({ fixture, scenario, line, radius, result }) {
  const parts = [
    `Fixture: ${fixture.displayPath}`,
    `Scenario: ${scenario}`,
    `Anchor line: ${line}`,
    `Radius: ${radius}`,
  ];
  if ("activated" in result) {
    parts.push(`Structure activated: ${String(result.activated)}`);
  }
  for (const snapshot of result.snapshots) {
    parts.push("");
    parts.push(`[${snapshot.label}] scrollTop=${snapshot.scrollTop} viewport=${snapshot.viewport}`);
    parts.push(...snapshot.lines.map((entry) =>
      `  L${entry.line}: top=${entry.top} height=${entry.height} ${JSON.stringify(entry.text)}`
    ));
    if (snapshot.surfaces.length > 0) {
      parts.push("  surfaces:");
      parts.push(...snapshot.surfaces.map((surface) =>
        `    ${surface.label} depth=${surface.depth + 1} lines=${surface.visibleTopLine ?? "-"}-${surface.visibleBottomLine ?? "-"} rect=${surface.rect ? `${surface.rect.width}x${surface.rect.height}@${surface.rect.top}` : "none"}`
      ));
    }
  }
  for (const delta of result.deltas) {
    parts.push("");
    parts.push(`[delta ${delta.from} -> ${delta.to}]`);
    parts.push(...delta.lines.map(formatLineDelta));
  }
  return parts.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const chromeArgs = parseChromeArgs(argv, { browser: "managed" });
  const { getFlag, getIntFlag, hasFlag } = createArgParser(argv);
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  const fixtureKey = getFlag("--fixture", "rankdecrease");
  const fixture = FIXTURES[fixtureKey];
  if (!fixture) {
    throw new Error(`Unknown fixture "${fixtureKey}".`);
  }
  const scenario = getFlag("--scenario", "structure");
  if (!["structure", "focus", "scroll"].includes(scenario)) {
    throw new Error(`Unknown scenario "${scenario}".`);
  }
  const line = getIntFlag("--line", fixture.defaultLine);
  const radius = getIntFlag("--radius", 3);

  const page = await connectEditor({
    browser: chromeArgs.browser,
    headless: chromeArgs.headless,
    port: chromeArgs.port,
    url: chromeArgs.url,
  });
  try {
    await waitForDebugBridge(page);
    await openFixtureDocument(page, fixture, { mode: "rich" });
    await assertEditorHealth(page, "geometry-audit: fixture-open", {
      maxVisibleDialogs: 2,
    });
    await sleep(300);

    let result;
    if (scenario === "structure") {
      result = await runStructureScenario(page, line, radius);
    } else if (scenario === "focus") {
      result = await runFocusScenario(page, line, radius);
    } else {
      result = await runScrollScenario(page, line, radius);
    }

    if (hasFlag("--json")) {
      console.log(JSON.stringify({
        fixture: fixture.displayPath,
        scenario,
        line,
        radius,
        result,
      }, null, 2));
    } else {
      console.log(formatReport({ fixture, scenario, line, radius, result }));
    }
  } finally {
    await disconnectBrowser(page);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
