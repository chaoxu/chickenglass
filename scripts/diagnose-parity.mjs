#!/usr/bin/env node
/**
 * Visual parity diagnostic between CM6 rich and Lexical surfaces.
 *
 * Captures the same fixture in both modes and dumps comparable measurements
 * for each shared surface that should look "almost pixel-identical":
 *
 *   - bibliography section (root tag, computed style, inner-text length, height)
 *   - first/last paragraph rect + line-height
 *   - inter-paragraph gaps (top of paragraph N+1 minus bottom of paragraph N)
 *   - heading rects per level
 *   - whole-document content height
 *
 * Prints a JSON report + a delta block listing differences > tolerance.
 * Saves per-surface PNG screenshots into /tmp/coflat-parity/ for visual diff.
 *
 * Use:
 *   node scripts/diagnose-parity.mjs [--fixture <path>]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { openBrowserSession, closeBrowserSession } from "./devx-browser-session.mjs";
import {
  switchToMode,
  openFile,
  waitForRenderReady,
  waitForSemanticReady,
} from "./editor-test-helpers.mjs";

const FIXTURE = process.argv.includes("--fixture")
  ? process.argv[process.argv.indexOf("--fixture") + 1]
  : "index.md";

const ARTIFACTS_DIR = "/tmp/coflat-parity";
if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function captureMode(page, mode, rootSelector) {
  // Scroll to bottom first so end-of-doc widgets (bibliography) are mounted
  // — CM6 only renders viewport-near content, so an unscrolled view will
  // not have the bibliography in the DOM at all.
  await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (root && "scrollTo" in root) {
      // CM6 uses a scroller inside .cm-editor; Lexical scrolls inside its host.
      root.scrollTo({ top: root.scrollHeight });
    }
    const editor = document.querySelector(".cm-editor .cm-scroller");
    if (editor) editor.scrollTo({ top: editor.scrollHeight });
    document.documentElement.scrollTo({ top: document.body.scrollHeight });
  }, rootSelector);
  await new Promise((resolve) => setTimeout(resolve, 600));
  return page.evaluate(({ selector, modeLabel }) => {
    const root = document.querySelector(selector);
    if (!root) return { mode: modeLabel, missing: true };

    function measureBlock(el) {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        className: el.className,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: {
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontFamily: style.fontFamily,
          color: style.color,
        },
        textLen: (el.textContent ?? "").length,
      };
    }

    const allParagraphs = Array.from(root.querySelectorAll(".cf-doc-paragraph, .cm-line:not(.cf-doc-heading):not(.cf-block-header):not(.cf-block-closing-fence)"));
    const paragraphRects = allParagraphs.map((p) => {
      const rect = p.getBoundingClientRect();
      return {
        y: rect.y,
        height: rect.height,
        textPreview: (p.textContent ?? "").trim().slice(0, 40),
      };
    });
    const paragraphGaps = [];
    for (let i = 1; i < paragraphRects.length; i++) {
      const prev = paragraphRects[i - 1];
      const curr = paragraphRects[i];
      const gap = curr.y - (prev.y + prev.height);
      paragraphGaps.push({
        gap: Math.round(gap),
        prevPreview: prev.textPreview,
        currPreview: curr.textPreview,
      });
    }

    const headings = ["h1", "h2", "h3"].map((tag) => {
      const el = root.querySelector(tag);
      return { tag, measure: measureBlock(el) };
    });

    // The .cf-bibliography class is overloaded — CM6 uses it for BOTH the
    // references section and the footnotes section (.cf-bibliography-footnotes
    // distinguishes). Pick the *references* section explicitly so we don't
    // compare a footnotes block in CM6 to a references block in Lexical.
    const bibSection = Array.from(document.querySelectorAll(".cf-bibliography"))
      .find((el) => !el.classList.contains("cf-bibliography-footnotes")) ?? null;
    const bibHeading = bibSection?.querySelector(".cf-bibliography-heading");
    const bibFirstEntry = bibSection?.querySelector(".cf-bibliography-entry");
    const bibLastEntry = bibSection ? Array.from(bibSection.querySelectorAll(".cf-bibliography-entry")).at(-1) : null;
    const bibIsInsideEditor = bibSection ? root.contains(bibSection) : null;

    return {
      mode: modeLabel,
      missing: false,
      rootHeight: root.getBoundingClientRect().height,
      contentHeight: root.scrollHeight,
      paragraphCount: allParagraphs.length,
      paragraphGaps: paragraphGaps.slice(0, 30),
      gapStats: paragraphGaps.length ? {
        min: Math.min(...paragraphGaps.map((g) => g.gap)),
        max: Math.max(...paragraphGaps.map((g) => g.gap)),
        mean: Math.round(paragraphGaps.reduce((acc, g) => acc + g.gap, 0) / paragraphGaps.length),
        median: paragraphGaps.map((g) => g.gap).sort((a, b) => a - b)[Math.floor(paragraphGaps.length / 2)],
      } : null,
      headings,
      bibliography: {
        section: measureBlock(bibSection),
        heading: measureBlock(bibHeading),
        firstEntry: measureBlock(bibFirstEntry),
        lastEntry: measureBlock(bibLastEntry),
        entryCount: bibSection ? bibSection.querySelectorAll(".cf-bibliography-entry").length : 0,
        insideEditor: bibIsInsideEditor,
      },
    };
  }, { selector: rootSelector, modeLabel: mode });
}

async function screenshotElement(page, selector, outPath) {
  try {
    const el = await page.$(selector);
    if (!el) return false;
    await el.screenshot({ path: outPath });
    return true;
  } catch (_error) {
    // Best-effort screenshot — diagnostic continues without this artifact
    // if the selector is missing in one of the two surfaces.
    return false;
  }
}

function deltaReport(cm6, lexical) {
  const findings = [];
  if (cm6.missing || lexical.missing) {
    findings.push(`Surface missing: cm6=${cm6.missing}, lexical=${lexical.missing}`);
    return findings;
  }
  const heightDelta = Math.abs(cm6.contentHeight - lexical.contentHeight);
  const heightPct = (heightDelta / Math.max(cm6.contentHeight, lexical.contentHeight)) * 100;
  if (heightPct > 5) {
    findings.push(`whole-doc content-height drift: cm6=${cm6.contentHeight}, lexical=${lexical.contentHeight} (${heightPct.toFixed(1)}%)`);
  }
  if (cm6.paragraphCount !== lexical.paragraphCount) {
    findings.push(`paragraph count differs: cm6=${cm6.paragraphCount}, lexical=${lexical.paragraphCount}`);
  }
  if (cm6.gapStats && lexical.gapStats) {
    const meanDelta = Math.abs(cm6.gapStats.mean - lexical.gapStats.mean);
    if (meanDelta > 2) {
      findings.push(`mean inter-paragraph gap differs: cm6=${cm6.gapStats.mean}px, lexical=${lexical.gapStats.mean}px (delta=${meanDelta}px)`);
    }
    const medianDelta = Math.abs(cm6.gapStats.median - lexical.gapStats.median);
    if (medianDelta > 2) {
      findings.push(`median inter-paragraph gap differs: cm6=${cm6.gapStats.median}px, lexical=${lexical.gapStats.median}px`);
    }
  }
  for (const surface of ["section", "heading", "firstEntry", "lastEntry"]) {
    const c = cm6.bibliography[surface];
    const l = lexical.bibliography[surface];
    if (!c || !l) {
      findings.push(`bibliography.${surface} missing in one mode (cm6=${!!c}, lexical=${!!l})`);
      continue;
    }
    if (c.tag !== l.tag) {
      findings.push(`bibliography.${surface} tag differs: cm6=${c.tag}, lexical=${l.tag}`);
    }
    const wDelta = Math.abs(c.rect.width - l.rect.width);
    const hDelta = Math.abs(c.rect.height - l.rect.height);
    if (wDelta > 4) findings.push(`bibliography.${surface} width differs by ${Math.round(wDelta)}px (cm6=${Math.round(c.rect.width)}, lexical=${Math.round(l.rect.width)})`);
    if (hDelta > 4) findings.push(`bibliography.${surface} height differs by ${Math.round(hDelta)}px (cm6=${Math.round(c.rect.height)}, lexical=${Math.round(l.rect.height)})`);
    for (const sk of ["fontSize", "lineHeight", "fontFamily", "marginTop", "marginBottom", "paddingTop", "paddingBottom"]) {
      if (c.style[sk] !== l.style[sk]) {
        findings.push(`bibliography.${surface}.${sk} differs: cm6=${c.style[sk]}, lexical=${l.style[sk]}`);
      }
    }
  }
  for (let i = 0; i < cm6.headings.length; i++) {
    const c = cm6.headings[i].measure;
    const l = lexical.headings[i].measure;
    if (!c || !l) continue;
    for (const sk of ["fontSize", "lineHeight", "marginTop", "marginBottom"]) {
      if (c.style[sk] !== l.style[sk]) {
        findings.push(`heading[${cm6.headings[i].tag}].${sk} differs: cm6=${c.style[sk]}, lexical=${l.style[sk]}`);
      }
    }
  }
  return findings;
}

async function main() {
  const session = await openBrowserSession([], { autoStart: true });
  try {
    await openFile(session.page, FIXTURE);
    await waitForSemanticReady(session.page, { timeoutMs: 10_000 });

    await switchToMode(session.page, "cm6-rich");
    await waitForRenderReady(session.page, { timeoutMs: 10_000 });
    const cm6 = await captureMode(session.page, "cm6-rich", ".cm-content");
    await screenshotElement(session.page, ".cm-content", `${ARTIFACTS_DIR}/cm6-content.png`);
    await screenshotElement(session.page, ".cf-bibliography:not(.cf-bibliography-footnotes)", `${ARTIFACTS_DIR}/cm6-references.png`);
    await screenshotElement(session.page, ".cf-bibliography.cf-bibliography-footnotes", `${ARTIFACTS_DIR}/cm6-footnotes.png`);

    await switchToMode(session.page, "lexical");
    await waitForRenderReady(session.page, { timeoutMs: 10_000 });
    const lexical = await captureMode(session.page, "lexical", "[contenteditable='true']");
    await screenshotElement(session.page, "[contenteditable='true']", `${ARTIFACTS_DIR}/lexical-content.png`);
    await screenshotElement(session.page, ".cf-bibliography:not(.cf-bibliography-footnotes)", `${ARTIFACTS_DIR}/lexical-references.png`);
    await screenshotElement(session.page, ".cf-bibliography.cf-bibliography-footnotes", `${ARTIFACTS_DIR}/lexical-footnotes.png`);

    const findings = deltaReport(cm6, lexical);
    const out = {
      fixture: FIXTURE,
      cm6_summary: {
        contentHeight: cm6.contentHeight,
        paragraphCount: cm6.paragraphCount,
        gapStats: cm6.gapStats,
        bibliography: {
          tag: cm6.bibliography.section?.tag,
          height: cm6.bibliography.section?.rect.height,
          entries: cm6.bibliography.entryCount,
          insideEditor: cm6.bibliography.insideEditor,
        },
      },
      lexical_summary: {
        contentHeight: lexical.contentHeight,
        paragraphCount: lexical.paragraphCount,
        gapStats: lexical.gapStats,
        bibliography: {
          tag: lexical.bibliography.section?.tag,
          height: lexical.bibliography.section?.rect.height,
          entries: lexical.bibliography.entryCount,
          insideEditor: lexical.bibliography.insideEditor,
        },
      },
      findings,
      screenshots: ARTIFACTS_DIR,
    };
    writeFileSync(`${ARTIFACTS_DIR}/parity-report.json`, JSON.stringify({ cm6, lexical, findings }, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await closeBrowserSession(session);
  }
}

main().catch((err) => {
  console.error("diagnose-parity failed:", err);
  process.exit(1);
});
