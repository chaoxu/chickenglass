#!/usr/bin/env node

import console from "node:console";
import process from "node:process";
import { closeBrowserSession, openBrowserSession } from "./devx-browser-session.mjs";

function printUsage() {
  console.log(`Usage:
  node scripts/browser-doctor.mjs [--browser managed|cdp] [--url URL] [--timeout MS] [--artifacts-dir DIR]

Checks that the browser harness is attached to the expected app page, the debug
bridge is ready, there is no Vite error overlay, and generic editor health is clean.`);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  let session = null;
  try {
    session = await openBrowserSession(argv);
    const state = await session.page.evaluate(() => ({
      currentDocument: window.__app?.getCurrentDocument?.() ?? null,
      mode: window.__app?.getMode?.() ?? null,
      url: window.location.href,
    }));
    console.log("Browser doctor passed.");
    console.log(JSON.stringify(state, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (session) {
      await closeBrowserSession(session);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

