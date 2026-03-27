---
name: browser-verify
description: Verify visual changes in the browser via CDP. Connects to the dev server, opens files, takes screenshots, and validates rendering.
---

# Browser Verify

Verify visual changes by connecting to the running dev server via Chrome DevTools Protocol.

## Prerequisites

The dev server and Chrome must already be running:
- `npm run dev` (Vite on port 5173)
- `npm run chrome` (CDP on port 9322)

If they aren't running, start them. **Only ONE dev server and ONE browser at a time.** Kill previous instances first:
```
kill $(lsof -ti:5173 -ti:5174 -ti:5175) 2>/dev/null; pkill -f "launch-chrome" 2>/dev/null
```

## Steps

### Step 1: Connect

Connect via CDP. Read `scripts/test-helpers.mjs` for the helper API.

```js
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP("http://localhost:9322");
const context = browser.contexts()[0];
const page = context.pages()[0];
page.setDefaultTimeout(10000);
```

### Step 2: Reload after code changes

If code was changed since the last check:
```js
await page.reload({ waitUntil: 'networkidle' });
```
Never open new browser instances -- always reload the existing page.

### Step 3: Open the target file

```js
await page.evaluate(() => __app.openFile("posts/index.md"));
```
Always open `index.md` first to verify default rendering. Then open the specific file relevant to your change.

### Step 4: Inspect state

Use `__cmDebug` helpers via `page.evaluate()`:
```js
const dump = await page.evaluate(() => __cmDebug.dump());
```

**Never use `locator.click()` on CM6 content.** Use `page.evaluate()` with the debug globals.

### Step 5: Screenshot

Use the `screenshot()` helper from `scripts/test-helpers.mjs`, or:
```
node scripts/screenshot.mjs [file] --output /tmp/coflat-verify.png
```

**Do not call `page.screenshot()` directly** -- Chrome 145's CDP has a headed-mode bug where it hangs indefinitely.

### Step 6: Compare and iterate

Read the screenshot. Compare against expected rendering. If something is wrong:
1. Fix the code
2. Reload the page (`page.reload()`)
3. Screenshot again
4. Repeat until correct

## Rules

- Do NOT use the Playwright MCP plugin -- connect directly via CDP.
- When launching Chrome directly in app mode, always pass `--disable-infobars`.
- Temporary screenshots go in `/tmp/coflat-*`.
- Visual changes are NOT verified until you have taken and examined a screenshot.

## References

- Debug globals: see "Debug helpers" in CLAUDE.md
- CDP test helpers: `scripts/test-helpers.mjs`
- Screenshot helper: `scripts/screenshot.mjs`
