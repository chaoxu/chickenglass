#!/usr/bin/env node
/**
 * CDP helper — runs a JS function against the open Playwright browser.
 * Usage: node scripts/cdp.js <command> [args...]
 *
 * Commands:
 *   nav <text>       — click a file tree item matching text
 *   scroll <top|bottom> — scroll editor to top or bottom
 *   screenshot <path> — take a screenshot
 *   eval <js>        — evaluate JS in the page
 */
const { chromium } = require("playwright");

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const browser = await chromium.connectOverCDP("http://localhost:9322");
  const page = browser.contexts()[0].pages()[0];

  switch (cmd) {
    case "nav": {
      const text = args.join(" ");
      const el = page.locator(`span:has-text("${text}")`);
      if ((await el.count()) > 0) {
        await el.first().click();
        await page.waitForTimeout(1000);
        console.log(`Clicked: ${text}`);
      } else {
        console.log(`Not found: ${text}`);
      }
      break;
    }
    case "scroll": {
      const dir = args[0] || "top";
      await page.evaluate(
        (d) => {
          const cm = document.querySelector(".cm-scroller");
          if (cm) cm.scrollTop = d === "bottom" ? cm.scrollHeight : 0;
        },
        dir,
      );
      await page.waitForTimeout(300);
      console.log(`Scrolled ${dir}`);
      break;
    }
    case "screenshot": {
      const path = args[0] || "/tmp/cg-screenshot.png";
      const { screenshot } = await import("./test-helpers.mjs");
      await screenshot(page, path, { timeout: 10000 });
      console.log(`Saved: ${path}`);
      break;
    }
    case "eval": {
      const js = args.join(" ");
      const result = await page.evaluate(js);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.log("Usage: node scripts/cdp.js <nav|scroll|screenshot|eval> [args]");
  }
}

main().catch(console.error);
