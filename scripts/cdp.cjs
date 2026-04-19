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

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log("Usage: node scripts/cdp.js <nav|scroll|screenshot|eval> [args]");
    return;
  }

  const { disconnectBrowser, openBrowserHarness, screenshot } = await import("./test-helpers.mjs");
  const { DEBUG_EDITOR_SELECTOR } = await import("./test-helpers/shared.mjs");
  const page = await openBrowserHarness({
    browser: "cdp",
    installEmbedStubs: false,
    port: 9322,
  });

  try {
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
          ({ direction, editorSelector }) => {
            const scroller =
              document.querySelector(".cf-lexical-surface--scroll") ??
              document.querySelector(editorSelector);
            if (scroller) {
              scroller.scrollTop = direction === "bottom" ? scroller.scrollHeight : 0;
            }
          },
          { direction: dir, editorSelector: DEBUG_EDITOR_SELECTOR },
        );
        await page.waitForTimeout(300);
        console.log(`Scrolled ${dir}`);
        break;
      }
      case "screenshot": {
        const path = args[0] || "/tmp/cg-screenshot.png";
        await screenshot(page, path, { timeout: 1500 });
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
  } finally {
    await disconnectBrowser(page);
  }
}

main().catch(console.error);
