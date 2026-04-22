#!/usr/bin/env node

import console from "node:console";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  closeBrowserSession,
  openBrowserPage,
  openBrowserSession,
} from "./devx-browser-session.mjs";
import {
  assertEditorHealth,
  captureDebugState,
  createArgParser,
  jumpToTextAnchor,
  openFixtureDocument,
  openFile,
  setCursor,
  sleep,
  switchToMode,
} from "./test-helpers.mjs";

export { openBrowserPage, openBrowserSession };

const COMPARABLE_CAPTURE_FIELDS = [
  "document",
  "mode",
  "selection",
  "structure",
  "render",
];
const UNSUPPORTED_REPLAY_KEYS = new Set([
  "Compose",
  "Dead",
  "Meta",
  "OS",
  "Process",
  "Shift",
  "Control",
  "Alt",
  "Unidentified",
]);

function printUsage() {
  console.log(`Browser repro / replay helper

Usage:
  node scripts/browser-repro.mjs capture [options]
  node scripts/browser-repro.mjs replay --session /tmp/coflat-debug/session.jsonl [options]
  node scripts/browser-repro.mjs diff --left /tmp/coflat-debug/a.jsonl --right /tmp/coflat-debug/b.jsonl [--json]

Shared browser options:
  --browser managed|cdp   Browser lane (default: managed for this script)
  --url http://localhost:5173
  --port 9322
  --timeout 30000
  --no-start-server
  --headed | --headless

Capture / replay options:
  --fixture index.md      Open a deterministic fixture via the shared harness
  --file notes.md         Open a file through window.__app.openFile()
  --mode cm6-rich|lexical|source Switch mode after opening
  --line 42               Place the cursor at a specific line
  --col 0                 Column offset for --line (0-based)
  --anchor-text "needle"  Jump to the first matching text anchor
  --anchor-occurrence 1   Match index for --anchor-text
  --anchor-offset 0       Character offset from the matched anchor
  --steps-file path.json  JSON array of steps to run after setup
  --steps-json '[...]'    Inline JSON array of steps
  --label "after repro"   Label for the final capture snapshot
  --output /tmp/out.json  Write JSON output to a file

Replay-only options:
  --session path.jsonl    Session file to replay
  --limit 50              Replay only the first N supported actions

Step JSON format:
  {"type":"press","key":"ArrowDown","modifiers":["Shift"]}
  {"type":"insertText","text":"abc"}
  {"type":"click","editorX":120,"editorY":80,"button":0}
  {"type":"setCursor","line":42,"col":0}
  {"type":"jumpToText","text":"Lemma","occurrence":1,"offset":0}
  {"type":"switchMode","mode":"cm6-rich"}
  {"type":"activateStructure"}
  {"type":"moveVertically","direction":"down","count":2}
  {"type":"sleep","ms":250}
  {"type":"capture","label":"checkpoint"}
`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }
}

function readJsonFile(path) {
  return parseJson(readFileSync(path, "utf8"), path);
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeValue(value[key]);
        return result;
      }, {});
  }
  return value ?? null;
}

function valuesEqual(left, right) {
  return JSON.stringify(normalizeValue(left)) === JSON.stringify(normalizeValue(right));
}

function normalizeCaptureForDiff(capture) {
  const comparable = {};
  for (const field of COMPARABLE_CAPTURE_FIELDS) {
    comparable[field] = capture?.[field] ?? null;
  }
  return comparable;
}

function mergedContextValue(next, key, fallback) {
  return Object.hasOwn(next, key)
    ? next[key]
    : fallback;
}

function mergeContext(base, next) {
  return {
    document: mergedContextValue(next, "document", base.document ?? null),
    mode: mergedContextValue(next, "mode", base.mode ?? null),
    selection: mergedContextValue(next, "selection", base.selection ?? null),
    render: mergedContextValue(next, "render", base.render ?? null),
    structure: mergedContextValue(next, "structure", base.structure ?? null),
    location: mergedContextValue(next, "location", base.location ?? ""),
  };
}

function modifierNames(detail) {
  const modifiers = [];
  if (detail.metaKey) modifiers.push("Meta");
  if (detail.ctrlKey) modifiers.push("Control");
  if (detail.altKey) modifiers.push("Alt");
  if (detail.shiftKey) modifiers.push("Shift");
  return modifiers;
}

function normalizeStep(step, index) {
  if (!isRecord(step) || typeof step.type !== "string") {
    throw new Error(`Invalid step at index ${index}: expected an object with a string "type".`);
  }

  switch (step.type) {
    case "press":
      if (typeof step.key !== "string" || step.key.length === 0) {
        throw new Error(`Invalid press step at index ${index}: missing "key".`);
      }
      return {
        type: "press",
        key: step.key,
        modifiers: Array.isArray(step.modifiers) ? step.modifiers.map(String) : [],
      };
    case "insertText":
      if (typeof step.text !== "string") {
        throw new Error(`Invalid insertText step at index ${index}: missing "text".`);
      }
      return {
        type: "insertText",
        text: step.text,
      };
    case "click":
      return {
        type: "click",
        editorX: toFiniteNumber(step.editorX),
        editorY: toFiniteNumber(step.editorY),
        clientX: toFiniteNumber(step.clientX),
        clientY: toFiniteNumber(step.clientY),
        button: typeof step.button === "number" ? step.button : 0,
        modifiers: Array.isArray(step.modifiers) ? step.modifiers.map(String) : [],
      };
    case "setCursor":
      if (!Number.isInteger(step.line) || step.line < 1) {
        throw new Error(`Invalid setCursor step at index ${index}: missing positive "line".`);
      }
      return {
        type: "setCursor",
        line: step.line,
        col: Number.isInteger(step.col) ? step.col : 0,
      };
    case "jumpToText":
      if (typeof step.text !== "string" || step.text.length === 0) {
        throw new Error(`Invalid jumpToText step at index ${index}: missing "text".`);
      }
      return {
        type: "jumpToText",
        text: step.text,
        occurrence: Number.isInteger(step.occurrence) ? step.occurrence : 1,
        offset: Number.isInteger(step.offset) ? step.offset : 0,
      };
    case "switchMode":
      if (!["rich", "cm6-rich", "lexical", "source"].includes(step.mode)) {
        throw new Error(`Invalid switchMode step at index ${index}: expected cm6-rich/lexical/source.`);
      }
      return {
        type: "switchMode",
        mode: step.mode,
      };
    case "activateStructure":
      return { type: "activateStructure" };
    case "moveVertically":
      if (!["up", "down"].includes(step.direction)) {
        throw new Error(`Invalid moveVertically step at index ${index}: expected up/down.`);
      }
      return {
        type: "moveVertically",
        direction: step.direction,
        count: Number.isInteger(step.count) && step.count > 0 ? step.count : 1,
      };
    case "sleep":
      if (!Number.isInteger(step.ms) || step.ms < 0) {
        throw new Error(`Invalid sleep step at index ${index}: missing non-negative "ms".`);
      }
      return {
        type: "sleep",
        ms: step.ms,
      };
    case "capture":
      return {
        type: "capture",
        label: typeof step.label === "string" && step.label.length > 0 ? step.label : null,
      };
    default:
      throw new Error(`Unsupported step type "${step.type}" at index ${index}.`);
  }
}

function parseStepsInput(raw, label) {
  if (!Array.isArray(raw)) {
    throw new Error(`${label} must be a JSON array of steps.`);
  }
  return raw.map((step, index) => normalizeStep(step, index));
}

function loadSteps(argv) {
  const { getFlag } = createArgParser(argv);
  const stepsFile = getFlag("--steps-file");
  const stepsJson = getFlag("--steps-json");
  if (stepsFile && stepsJson) {
    throw new Error("Use either --steps-file or --steps-json, not both.");
  }
  if (stepsFile) {
    return parseStepsInput(readJsonFile(stepsFile), stepsFile);
  }
  if (stepsJson) {
    return parseStepsInput(parseJson(stepsJson, "--steps-json"), "--steps-json");
  }
  return [];
}

function pointerActionFromEvent(event) {
  const detail = event?.detail;
  if (!isRecord(detail)) return null;
  const editorX = toFiniteNumber(detail.editorX);
  const editorY = toFiniteNumber(detail.editorY);
  const clientX = toFiniteNumber(detail.clientX);
  const clientY = toFiniteNumber(detail.clientY);
  if (editorX === null && clientX === null) return null;
  return {
    type: "click",
    editorX,
    editorY,
    clientX,
    clientY,
    button: typeof detail.button === "number" ? detail.button : 0,
    modifiers: modifierNames(detail),
  };
}

function keyActionFromEvent(event) {
  const detail = event?.detail;
  if (!isRecord(detail) || typeof detail.key !== "string" || detail.key.length === 0) {
    return null;
  }
  if (UNSUPPORTED_REPLAY_KEYS.has(detail.key)) {
    return null;
  }
  const modifiers = modifierNames(detail);
  if (detail.key.length === 1 && !detail.metaKey && !detail.ctrlKey && !detail.altKey) {
    return {
      type: "insertText",
      text: detail.key,
    };
  }
  return {
    type: "press",
    key: detail.key,
    modifiers,
  };
}

export function parseSessionEvents(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseJson(line, `session line ${index + 1}`));
}

export function extractReplayActions(events) {
  const actions = [];
  let skipped = 0;

  for (const event of events) {
    if (!isRecord(event) || typeof event.type !== "string") {
      skipped += 1;
      continue;
    }

    let action = null;
    if (event.type === "key") {
      action = keyActionFromEvent(event);
    } else if (event.type === "pointer") {
      action = pointerActionFromEvent(event);
    }

    if (action) {
      actions.push(action);
    } else if (event.type === "key" || event.type === "pointer") {
      skipped += 1;
    }
  }

  return {
    actions,
    skipped,
  };
}

function extractCaptureFromEvent(event) {
  if (!isRecord(event) || event.type !== "snapshot" || !isRecord(event.detail)) {
    return null;
  }
  return event.detail;
}

export function summarizeSessionEvents(events) {
  const eventCounts = {};
  let lastContext = {
    document: null,
    mode: null,
    selection: null,
    render: null,
    structure: null,
    location: "",
  };
  let lastCapture = null;

  for (const event of events) {
    if (isRecord(event) && typeof event.type === "string") {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      if (isRecord(event.context)) {
        lastContext = mergeContext(lastContext, event.context);
      }
      const capture = extractCaptureFromEvent(event);
      if (capture) {
        lastCapture = capture;
      }
    }
  }

  const replay = extractReplayActions(events);
  return {
    eventCount: events.length,
    eventCounts,
    lastContext,
    lastCapture,
    comparableCapture: normalizeCaptureForDiff(lastCapture ?? lastContext),
    captureSource: lastCapture ? "snapshot" : "context",
    replayableActionCount: replay.actions.length,
    skippedReplayEvents: replay.skipped,
  };
}

export function diffDebugStates(left, right) {
  const differences = COMPARABLE_CAPTURE_FIELDS
    .filter((field) => !valuesEqual(left?.[field], right?.[field]))
    .map((field) => ({
      field,
      left: left?.[field] ?? null,
      right: right?.[field] ?? null,
    }));

  return {
    equal: differences.length === 0,
    differences,
  };
}

export function diffSessionSummaries(left, right) {
  const eventTypes = Array.from(
    new Set([...Object.keys(left.eventCounts), ...Object.keys(right.eventCounts)]),
  ).sort();
  const eventCountDifferences = eventTypes
    .filter((type) => (left.eventCounts[type] ?? 0) !== (right.eventCounts[type] ?? 0))
    .map((type) => ({
      type,
      left: left.eventCounts[type] ?? 0,
      right: right.eventCounts[type] ?? 0,
    }));
  const captureDiff = diffDebugStates(left.comparableCapture, right.comparableCapture);

  return {
    equal: captureDiff.equal && eventCountDifferences.length === 0,
    captureDiff,
    eventCountDifferences,
  };
}

function formatDiffReport(leftPath, rightPath, leftSummary, rightSummary, diff) {
  const lines = [
    `left:  ${leftPath} (${leftSummary.captureSource})`,
    `right: ${rightPath} (${rightSummary.captureSource})`,
  ];

  if (diff.eventCountDifferences.length === 0 && diff.captureDiff.equal) {
    lines.push("");
    lines.push("No event-count or capture-state differences.");
    return lines.join("\n");
  }

  if (diff.eventCountDifferences.length > 0) {
    lines.push("");
    lines.push("Event count differences:");
    for (const entry of diff.eventCountDifferences) {
      lines.push(`- ${entry.type}: ${entry.left} -> ${entry.right}`);
    }
  }

  if (!diff.captureDiff.equal) {
    lines.push("");
    lines.push("Capture state differences:");
    for (const entry of diff.captureDiff.differences) {
      lines.push(`- ${entry.field}:`);
      lines.push(`  left=${JSON.stringify(entry.left)}`);
      lines.push(`  right=${JSON.stringify(entry.right)}`);
    }
  }

  return lines.join("\n");
}

function keyNameForPress(key) {
  switch (key) {
    case " ":
      return "Space";
    case "Esc":
      return "Escape";
    case "OS":
      return "Meta";
    case "Left":
      return "ArrowLeft";
    case "Right":
      return "ArrowRight";
    case "Up":
      return "ArrowUp";
    case "Down":
      return "ArrowDown";
    default:
      return key;
  }
}

async function withModifiers(page, modifiers, run) {
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }
  try {
    return await run();
  } finally {
    for (const modifier of [...modifiers].reverse()) {
      await page.keyboard.up(modifier);
    }
  }
}

async function focusEditor(page) {
  await page.evaluate(() => {
    window.__cmView?.focus();
  });
}

async function clickAtRecordedPosition(page, action) {
  const point = await page.evaluate(({ editorX, editorY, clientX, clientY }) => {
    const rect = window.__cmView?.contentDOM?.getBoundingClientRect?.();
    if (rect && editorX !== null && editorY !== null) {
      return {
        x: rect.left + editorX,
        y: rect.top + editorY,
      };
    }
    if (clientX !== null && clientY !== null) {
      return {
        x: clientX,
        y: clientY,
      };
    }
    return null;
  }, action);

  if (!point) {
    throw new Error("Pointer replay step is missing usable coordinates.");
  }

  const button = action.button === 1
    ? "middle"
    : action.button === 2
      ? "right"
      : "left";

  await page.mouse.click(point.x, point.y, { button });
}

async function runStep(page, step, captures) {
  switch (step.type) {
    case "press":
      await focusEditor(page);
      await withModifiers(page, step.modifiers, async () => {
        await page.keyboard.press(keyNameForPress(step.key));
      });
      await sleep(100);
      return;
    case "insertText":
      await focusEditor(page);
      await page.keyboard.insertText(step.text);
      await sleep(100);
      return;
    case "click":
      await withModifiers(page, step.modifiers, async () => {
        await clickAtRecordedPosition(page, step);
      });
      await sleep(100);
      return;
    case "setCursor":
      await setCursor(page, step.line, step.col);
      return;
    case "jumpToText":
      await jumpToTextAnchor(page, step.text, {
        occurrence: step.occurrence,
        offset: step.offset,
      });
      return;
    case "switchMode":
      await switchToMode(page, step.mode);
      return;
    case "activateStructure": {
      const activated = await page.evaluate(() => window.__cmDebug.activateStructureAtCursor());
      if (!activated) {
        throw new Error("activateStructure step failed at the current cursor.");
      }
      await sleep(150);
      return;
    }
    case "moveVertically":
      for (let index = 0; index < step.count; index += 1) {
        const moved = await page.evaluate((direction) => window.__cmDebug.moveVertically(direction), step.direction);
        if (!moved) {
          throw new Error(`moveVertically(${step.direction}) failed on iteration ${index + 1}.`);
        }
      }
      await sleep(100);
      return;
    case "sleep":
      await sleep(step.ms);
      return;
    case "capture":
      captures.push(await captureDebugState(page, step.label));
      return;
    default:
      throw new Error(`Unsupported step type "${step.type}".`);
  }
}

async function preparePage(page, argv) {
  const { getFlag, getIntFlag } = createArgParser(argv);
  const fixture = getFlag("--fixture");
  const file = getFlag("--file");
  const mode = getFlag("--mode");
  const line = getIntFlag("--line", 0);
  const col = getIntFlag("--col", 0);
  const anchorText = getFlag("--anchor-text");
  const anchorOccurrence = getIntFlag("--anchor-occurrence", 1);
  const anchorOffset = getIntFlag("--anchor-offset", 0);

  if (fixture && file) {
    throw new Error("Use either --fixture or --file, not both.");
  }

  if (fixture) {
    await openFixtureDocument(page, fixture, {
      mode: mode ?? undefined,
      project: "full-project",
    });
  } else if (file) {
    await openFile(page, file);
    if (mode) {
      await switchToMode(page, mode);
    }
  } else if (mode) {
    await switchToMode(page, mode);
  }

  if (line > 0) {
    await setCursor(page, line, col);
  } else if (anchorText) {
    await jumpToTextAnchor(page, anchorText, {
      occurrence: anchorOccurrence,
      offset: anchorOffset,
    });
  }
}

function maybeWriteOutput(path, payload) {
  const text = JSON.stringify(payload, null, 2);
  if (path) {
    writeFileSync(path, `${text}\n`);
  }
  console.log(text);
}

async function runCaptureCommand(argv) {
  const { getFlag } = createArgParser(argv);
  const steps = loadSteps(argv);
  const label = getFlag("--label") ?? "capture";
  const outputPath = getFlag("--output");
  const session = await openBrowserSession(argv);
  const { page } = session;

  try {
    await preparePage(page, argv);
    await assertEditorHealth(page, "browser-repro capture: setup", {
      maxVisibleDialogs: 2,
    });

    const captures = [];
    for (const step of steps) {
      await runStep(page, step, captures);
    }

    await assertEditorHealth(page, "browser-repro capture: final", {
      maxVisibleDialogs: 2,
    });
    const finalCapture = await captureDebugState(page, label);
    captures.push(finalCapture);

    maybeWriteOutput(outputPath, {
      command: "capture",
      stepsRun: steps.length,
      captures,
      finalCapture,
    });
  } finally {
    await closeBrowserSession(session);
  }
}

async function runReplayCommand(argv) {
  const { getFlag, getIntFlag } = createArgParser(argv);
  const sessionPath = getFlag("--session");
  if (!sessionPath) {
    throw new Error("replay requires --session <path>.");
  }

  const events = parseSessionEvents(readFileSync(sessionPath, "utf8"));
  const summary = summarizeSessionEvents(events);
  const replay = extractReplayActions(events);
  const limit = getIntFlag("--limit", replay.actions.length);
  const actions = replay.actions.slice(0, Math.max(0, limit));
  const outputPath = getFlag("--output");
  const label = getFlag("--label") ?? `replay ${basename(sessionPath)}`;
  const session = await openBrowserSession(argv);
  const { page } = session;

  try {
    await preparePage(page, argv);
    await assertEditorHealth(page, "browser-repro replay: setup", {
      maxVisibleDialogs: 2,
    });

    const captures = [];
    for (const action of actions) {
      await runStep(page, action, captures);
    }

    await assertEditorHealth(page, "browser-repro replay: final", {
      maxVisibleDialogs: 2,
    });
    const finalCapture = await captureDebugState(page, label);
    captures.push(finalCapture);

    maybeWriteOutput(outputPath, {
      command: "replay",
      sessionPath,
      sessionSummary: summary,
      replayedActions: actions.length,
      skippedReplayEvents: replay.skipped,
      captures,
      finalCapture,
    });
  } finally {
    await closeBrowserSession(session);
  }
}

async function runDiffCommand(argv) {
  const { getFlag, hasFlag } = createArgParser(argv);
  const leftPath = getFlag("--left");
  const rightPath = getFlag("--right");
  if (!leftPath || !rightPath) {
    throw new Error("diff requires --left <path> and --right <path>.");
  }

  const leftSummary = summarizeSessionEvents(parseSessionEvents(readFileSync(leftPath, "utf8")));
  const rightSummary = summarizeSessionEvents(parseSessionEvents(readFileSync(rightPath, "utf8")));
  const diff = diffSessionSummaries(leftSummary, rightSummary);

  if (hasFlag("--json")) {
    console.log(JSON.stringify({
      leftPath,
      rightPath,
      leftSummary,
      rightSummary,
      diff,
    }, null, 2));
    return;
  }

  console.log(formatDiffReport(leftPath, rightPath, leftSummary, rightSummary, diff));
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "capture") {
    await runCaptureCommand(rest);
    return;
  }
  if (command === "replay") {
    await runReplayCommand(rest);
    return;
  }
  if (command === "diff") {
    await runDiffCommand(rest);
    return;
  }

  throw new Error(`Unknown subcommand "${command}".`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
