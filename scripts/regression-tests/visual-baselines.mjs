#!/usr/bin/env node
/**
 * Structural visual baselines.
 *
 * For each canonical authoring state (math, citations, theorem, table, figure,
 * dark-mode, plain-text), this script:
 *   1. Loads a deterministic inline fixture into the running app.
 *   2. Switches to cm6-rich mode and waits for render.
 *   3. Captures a normalized JSON description of the rendered surface:
 *        - dom: serialized normalized tree (tag, classes, key attrs, text)
 *        - computedStyles: a small set of styles for canonical selectors
 *        - anchors: marker nodes (math, fenced-div headers, table caption,
 *          figure caption, citation cite element, code blocks, headings)
 *   4. Compares against fixtures/visual-baselines/<name>.json (exact match
 *      after deterministic JSON serialization) or writes the baseline when
 *      `--update` is passed.
 *
 * Update flow:
 *
 *   pnpm test:browser:visual -- --update
 *
 * Reads/writes one baseline file per canonical state under
 * fixtures/visual-baselines/. Diff output on mismatch is structured: it lists
 * each path that differs as `<json/path>: <baseline> -> <current>` so the
 * meaningful change is obvious without screenshot eyeballing.
 *
 * Tauri lane:
 *
 *   COFLAT_TAURI_URL=http://127.0.0.1:1420 pnpm test:browser:visual
 *
 * When COFLAT_TAURI_URL is set, the script connects to that URL instead of the
 * default Vite/managed-Chromium app and writes/compares baselines under the
 * `tauri/` subdirectory. This requires `pnpm tauri:dev` to be running locally
 * and exposing the configured URL. See README in fixtures/visual-baselines/.
 *
 * Constraints intentionally enforced by the snapshotter:
 *   - No absolute positions (viewport-dependent).
 *   - No timestamps, random IDs, or measurement-derived numbers.
 *   - Stable element ordering (DOM order under a fixed root).
 *   - Text is collapsed/whitespace-normalized and clipped per node.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { closeBrowserSession, openBrowserSession } from "../devx-browser-session.mjs";
import { createArgParser, normalizeCliArgs } from "../devx-cli.mjs";
import {
  switchToMode,
  waitForRenderReady,
  settleEditorLayout,
} from "../test-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const BASELINES_DIR = join(REPO_ROOT, "fixtures", "visual-baselines");

export const name = "visual-baselines";
export const excludeFromDefaultLane = true;

// --- Canonical states ---------------------------------------------------------
//
// Each state has a unique `id`, a markdown body, and an optional `darkMode`
// flag. Every body is intentionally short so the lane stays under the 30s
// runtime budget. The bodies must use FORMAT.md-compliant pandoc markdown.

const STATES = [
  {
    id: "plain",
    title: "Plain text control",
    file: "plain.md",
    content: [
      "---",
      "title: Plain Control",
      "---",
      "",
      "# Heading",
      "",
      "Paragraph text with **bold** and *italic* spans.",
      "",
      "- list item one",
      "- list item two",
      "",
    ].join("\n"),
  },
  {
    id: "math",
    title: "Inline + display math with label and crossref",
    file: "math.md",
    content: [
      "---",
      "title: Math Doc",
      "---",
      "",
      "# Math",
      "",
      "Inline math $a^2 + b^2 = c^2$ in a paragraph.",
      "",
      "$$",
      "E = m c^2",
      "$$ {#eq:energy}",
      "",
      "See [@eq:energy] for the relation.",
      "",
    ].join("\n"),
  },
  {
    id: "citation",
    title: "Citation with bibliography",
    file: "citation.md",
    content: [
      "---",
      "title: Citation Doc",
      "bibliography: refs.bib",
      "---",
      "",
      "# Citations",
      "",
      "We rely on @karger2000 for randomized min-cut.",
      "",
      "## References",
      "",
    ].join("\n"),
    extraFiles: {
      "refs.bib": [
        "@article{karger2000,",
        "  author = {Karger, David R.},",
        "  title  = {Minimum Cuts in Near-Linear Time},",
        "  journal = {J. ACM},",
        "  year   = {2000}",
        "}",
        "",
      ].join("\n"),
    },
  },
  {
    id: "theorem",
    title: "Theorem + proof + definition fenced divs",
    file: "theorem.md",
    content: [
      "---",
      "title: Theorem Doc",
      "---",
      "",
      "# Theorems",
      "",
      "::: {.definition #def:graph title=\"Graph\"}",
      "A graph is a pair $(V, E)$.",
      ":::",
      "",
      "::: {.theorem #thm:euler title=\"Euler\"}",
      "For a connected planar graph $V - E + F = 2$.",
      ":::",
      "",
      "::: {.proof}",
      "Trivial.",
      ":::",
      "",
    ].join("\n"),
  },
  {
    id: "table",
    title: "Table with caption and crossref",
    file: "table.md",
    content: [
      "---",
      "title: Table Doc",
      "---",
      "",
      "# Tables",
      "",
      "| Stage | Outcome |",
      "|-------|---------|",
      "| open  | ok      |",
      "| edit  | ok      |",
      "",
      ": Authoring smoke. {#tbl:smoke}",
      "",
      "Refer to [@tbl:smoke] above.",
      "",
    ].join("\n"),
  },
  {
    id: "figure",
    title: "Figure with caption",
    file: "figure.md",
    content: [
      "---",
      "title: Figure Doc",
      "---",
      "",
      "# Figures",
      "",
      "![A caption for the figure.](missing.png){#fig:placeholder}",
      "",
      "See [@fig:placeholder].",
      "",
    ].join("\n"),
  },
  {
    id: "dark-mode",
    title: "Dark mode rendering of math + theorem",
    file: "dark.md",
    darkMode: true,
    content: [
      "---",
      "title: Dark Mode",
      "---",
      "",
      "# Dark Mode",
      "",
      "Inline math $x^2$ renders in dark theme.",
      "",
      "::: {.theorem #thm:dark title=\"Dark\"}",
      "Body of theorem.",
      ":::",
      "",
    ].join("\n"),
  },
];

// --- Snapshot capture (runs in browser) --------------------------------------

/**
 * Returns a normalized DOM tree + anchors + key computed styles. Pure
 * function of the rendered DOM at call time, no positions, no random IDs.
 */
function captureSnapshotInPage() {
  const ROOT_SELECTOR = ".cm-content";
  const root = document.querySelector(ROOT_SELECTOR);
  if (!(root instanceof HTMLElement)) {
    return { error: `root selector ${ROOT_SELECTOR} not found` };
  }

  const collapseWs = (s) => (s ?? "").replace(/\s+/g, " ").trim();

  // Attributes worth keeping for structural identity. Anything position- or
  // measurement-derived (e.g. style="height: 24px") is dropped.
  const KEEP_ATTRS = new Set([
    "class",
    "data-section-number",
    "data-block-kind",
    "data-block-number",
    "data-target",
    "data-target-id",
    "data-target-kind",
    "data-target-label",
    "role",
  ]);

  const stripVolatileClasses = (cls) => {
    if (!cls) return [];
    return cls
      .split(/\s+/)
      .filter(Boolean)
      // drop CM6's per-line cm-line-N variants; cm-line itself is fine
      .filter((c) => !/^cm-line-\d+$/.test(c))
      // drop measurement-derived numeric tail classes if any future appear
      .filter((c) => !/^cf-measure-/.test(c))
      .sort();
  };

  const serialize = (node, depth = 0) => {
    if (depth > 12) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      const t = collapseWs(node.textContent);
      return t ? { t } : null;
    }
    if (!(node instanceof HTMLElement)) return null;
    // Skip hidden bookkeeping nodes that CM6 inserts for measurement.
    if (node.classList.contains("cm-widgetBuffer")) return null;

    const out = { e: node.tagName.toLowerCase() };
    const cls = stripVolatileClasses(node.getAttribute("class"));
    if (cls.length > 0) out.c = cls;
    const attrs = {};
    for (const attr of node.attributes) {
      if (KEEP_ATTRS.has(attr.name) && attr.name !== "class") {
        attrs[attr.name] = attr.value;
      }
    }
    if (Object.keys(attrs).length > 0) out.a = attrs;

    // For KaTeX-rendered math, prefer the TeX annotation as the canonical
    // textual content rather than walking the giant MathML/HTML mirror.
    if (node.classList.contains("katex")) {
      const ann = node.querySelector('annotation[encoding="application/x-tex"]');
      out.tex = collapseWs(ann?.textContent ?? "");
      return out;
    }

    const children = [];
    for (const child of node.childNodes) {
      const sc = serialize(child, depth + 1);
      if (sc) children.push(sc);
    }
    if (children.length > 0) out.k = children;
    return out;
  };

  const dom = serialize(root, 0);

  // Anchor list: distinguished marker nodes that name what's on screen.
  const anchorSelectors = [
    { kind: "heading", selector: "[data-section-number]", attrs: ["data-section-number"], text: true },
    { kind: "block-header", selector: ".cf-block-header", attrs: ["data-block-kind", "data-block-number"], text: true },
    { kind: "math-display", selector: ".cf-math-display", attrs: [], text: false },
    { kind: "math-display-number", selector: ".cf-math-display-number", attrs: [], text: true },
    { kind: "math-inline", selector: ".cf-math-inline", attrs: [], text: false },
    { kind: "katex-tex", selector: ".katex annotation", attrs: ["encoding"], text: true },
    { kind: "citation", selector: ".cf-citation, .cf-cite", attrs: ["data-target"], text: true },
    { kind: "crossref", selector: ".cf-crossref, .cf-ref", attrs: ["data-target", "data-target-kind"], text: true },
    { kind: "table-caption", selector: ".cf-table-caption, figcaption", attrs: ["data-target-id"], text: true },
    { kind: "figure", selector: "figure", attrs: ["id"], text: false },
    { kind: "code-block", selector: ".cf-code-block, pre code", attrs: [], text: false },
    { kind: "list-item", selector: "li", attrs: [], text: false },
  ];

  const anchors = [];
  for (const spec of anchorSelectors) {
    const els = root.querySelectorAll(spec.selector);
    let count = 0;
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      const entry = { kind: spec.kind, selector: spec.selector };
      const a = {};
      for (const k of spec.attrs) {
        const v = el.getAttribute(k);
        if (v != null) a[k] = v;
      }
      if (Object.keys(a).length > 0) entry.attrs = a;
      if (spec.text) {
        const t = collapseWs(el.textContent);
        if (t) entry.textSnippet = t.slice(0, 120);
      }
      anchors.push(entry);
      count++;
      if (count >= 50) break; // safety
    }
  }

  // Computed styles: a small, theme-sensitive set per canonical selector.
  // Numbers like font-size are theme-driven and stable across viewports of
  // the same DPI, so they can serve as a dark-mode signal.
  const styleSelectors = [
    { selector: ".cm-content", props: ["color", "font-family"] },
    { selector: ".cf-block-header", props: ["color", "font-weight"] },
    { selector: ".cf-math-display", props: ["text-align"] },
    { selector: ".cf-citation, .cf-cite", props: ["color"] },
  ];
  const computedStyles = {};
  for (const spec of styleSelectors) {
    const el = document.querySelector(spec.selector);
    if (!(el instanceof Element)) continue;
    const cs = window.getComputedStyle(el);
    const obj = {};
    for (const p of spec.props) obj[p] = cs.getPropertyValue(p).trim();
    computedStyles[spec.selector] = obj;
  }

  const themeAttr = document.documentElement.getAttribute("data-theme") ?? "default";

  return {
    rootSelector: ROOT_SELECTOR,
    theme: themeAttr,
    dom,
    anchors,
    computedStyles,
  };
}

// --- Browser-side helpers ----------------------------------------------------

async function loadState(page, state) {
  const result = await page.evaluate(async (payload) => {
    const app = window.__app;
    if (!app) throw new Error("__app bridge unavailable");
    if (payload.extraFiles && app.loadFixtureProject) {
      const files = [
        { path: payload.file, kind: "text", content: payload.content },
        ...Object.entries(payload.extraFiles).map(([path, content]) => ({
          path,
          kind: "text",
          content,
        })),
      ];
      await app.loadFixtureProject(files, payload.file);
      return { method: "loadFixtureProject" };
    }
    if (!app.openFileWithContent) {
      throw new Error("__app.openFileWithContent unavailable");
    }
    await app.openFileWithContent(payload.file, payload.content);
    return { method: "openFileWithContent" };
  }, { file: state.file, content: state.content, extraFiles: state.extraFiles ?? null });
  return result;
}

async function setTheme(page, dark) {
  await page.evaluate((isDark) => {
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, dark);
}

async function captureSnapshot(page) {
  return page.evaluate(captureSnapshotInPage);
}

// --- Diff --------------------------------------------------------------------

function deepDiff(a, b, path = "$", out = []) {
  if (Object.is(a, b)) return out;
  const ta = typeofTag(a);
  const tb = typeofTag(b);
  if (ta !== tb) {
    out.push({ path, baseline: a, current: b });
    return out;
  }
  if (ta === "array") {
    const max = Math.max(a.length, b.length);
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, baseline: a.length, current: b.length });
    }
    for (let i = 0; i < max; i++) {
      deepDiff(a[i], b[i], `${path}[${i}]`, out);
    }
    return out;
  }
  if (ta === "object") {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const k of [...keys].sort()) {
      deepDiff(a?.[k], b?.[k], `${path}.${k}`, out);
    }
    return out;
  }
  out.push({ path, baseline: a, current: b });
  return out;
}

function typeofTag(v) {
  if (v === null || v === undefined) return "nullish";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function summarizeValue(v) {
  if (v === undefined) return "<missing>";
  const s = JSON.stringify(v);
  if (s == null) return String(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

// --- Baseline IO -------------------------------------------------------------

function baselineDir(opts) {
  if (opts.tauri) return join(BASELINES_DIR, "tauri");
  return BASELINES_DIR;
}

function baselinePath(opts, id) {
  return join(baselineDir(opts), `${id}.json`);
}

function stableStringify(value) {
  // Sort object keys recursively for deterministic JSON output.
  const visit = (v) => {
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = visit(v[k]);
      return out;
    }
    return v;
  };
  return `${JSON.stringify(visit(value), null, 2)}\n`;
}

function readBaseline(opts, id) {
  const p = baselinePath(opts, id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeBaseline(opts, id, snapshot) {
  const dir = baselineDir(opts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(baselinePath(opts, id), stableStringify(snapshot));
}

// --- Runner ------------------------------------------------------------------

async function runState(page, state, opts) {
  await loadState(page, state);
  await switchToMode(page, "cm6-rich");
  await setTheme(page, Boolean(state.darkMode));
  await waitForRenderReady(page);
  await settleEditorLayout(page, { frameCount: 3, delayMs: 64 });
  const snapshot = await captureSnapshot(page);
  // Always reset theme to avoid leaking dark mode into later states.
  await setTheme(page, false);

  if (snapshot && snapshot.error) {
    return { id: state.id, pass: false, message: snapshot.error };
  }

  const wrapped = {
    id: state.id,
    title: state.title,
    file: state.file,
    snapshot,
  };

  if (opts.update) {
    writeBaseline(opts, state.id, wrapped);
    return { id: state.id, pass: true, message: `wrote baseline ${state.id}` };
  }

  const baseline = readBaseline(opts, state.id);
  if (!baseline) {
    return {
      id: state.id,
      pass: false,
      message: `no baseline at ${baselinePath(opts, state.id)}; run with --update to create it`,
    };
  }
  const diffs = deepDiff(baseline, wrapped);
  if (diffs.length === 0) {
    return { id: state.id, pass: true, message: "match" };
  }
  return {
    id: state.id,
    pass: false,
    message: `${diffs.length} differing path(s)`,
    diffs,
  };
}

function printResult(r) {
  const status = r.pass ? "PASS" : "FAIL";
  console.log(`  ${status}  ${r.id}  ${r.message}`);
  if (!r.pass && r.diffs) {
    const limit = 20;
    for (const d of r.diffs.slice(0, limit)) {
      console.log(`        ${d.path}: ${summarizeValue(d.baseline)} -> ${summarizeValue(d.current)}`);
    }
    if (r.diffs.length > limit) {
      console.log(`        ... ${r.diffs.length - limit} more`);
    }
  }
}

export async function run(page, options = {}) {
  // Allows the existing test-regression runner to invoke this as a regular
  // regression test (compare-only mode against committed baselines).
  const opts = { update: false, tauri: false, ...options };
  const results = [];
  for (const state of STATES) {
    const r = await runState(page, state, opts);
    results.push(r);
    printResult(r);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    return {
      pass: false,
      message: `${failed.length}/${results.length} canonical states differ from baseline`,
    };
  }
  return { pass: true, message: `${results.length} canonical states match baseline` };
}

// --- CLI ---------------------------------------------------------------------

async function main() {
  const args = normalizeCliArgs(process.argv.slice(2));
  const { hasFlag } = createArgParser(args);
  const update = hasFlag("--update");
  const tauri = hasFlag("--tauri") || Boolean(process.env.COFLAT_TAURI_URL);

  const sessionArgs = [...args];
  if (tauri && process.env.COFLAT_TAURI_URL && !sessionArgs.includes("--url")) {
    sessionArgs.push("--url", process.env.COFLAT_TAURI_URL);
  }

  console.log(`Visual baselines  (${update ? "UPDATE" : "VERIFY"}${tauri ? ", tauri" : ""})`);
  console.log("===============================================");

  let session = null;
  let exitCode = 0;
  try {
    session = await openBrowserSession(sessionArgs);
    const results = [];
    for (const state of STATES) {
      const r = await runState(session.page, state, { update, tauri });
      results.push(r);
      printResult(r);
    }
    const failed = results.filter((r) => !r.pass);
    if (failed.length > 0) {
      console.log(`\n${failed.length}/${results.length} canonical state(s) FAILED.`);
      if (!update) {
        console.log("Re-run with --update if the rendering change is intentional.");
      }
      exitCode = 1;
    } else {
      console.log(`\n${results.length}/${results.length} canonical states OK.`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    exitCode = 1;
  } finally {
    if (session) await closeBrowserSession(session);
  }
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
