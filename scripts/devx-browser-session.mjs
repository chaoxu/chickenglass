import console from "node:console";
import {
  connectEditor,
  disconnectBrowser,
  ensureAppServer,
  waitForDebugBridge,
} from "./browser-lifecycle.mjs";
import { parseChromeArgs } from "./chrome-common.mjs";
import { createArgParser } from "./devx-cli.mjs";

/**
 * Open a script-owned browser session and, for managed localhost sessions,
 * start a Vite dev server if needed.
 */
export async function openBrowserSession(argv = [], options = {}) {
  const {
    autoStartServer = true,
    defaultBrowser = "managed",
    reloadCdp = true,
    timeoutFallback = 15000,
  } = options;
  const { getIntFlag, hasFlag } = createArgParser(argv);
  const chromeArgs = parseChromeArgs(argv, { browser: defaultBrowser });
  const timeout = getIntFlag("--timeout", timeoutFallback);
  const stopAppServer = await ensureAppServer(chromeArgs.url, {
    autoStart: autoStartServer && !hasFlag("--no-start-server"),
  });
  let page = null;

  try {
    page = await connectEditor({
      browser: chromeArgs.browser,
      headless: chromeArgs.headless,
      port: chromeArgs.port,
      timeout,
      url: chromeArgs.url,
    });

    if (reloadCdp && chromeArgs.browser === "cdp") {
      await page.reload({ waitUntil: "load" });
    }

    await waitForDebugBridge(page, { timeout });
    return {
      page,
      stopAppServer,
    };
  } catch (error) {
    if (page) {
      await disconnectBrowser(page).catch((disconnectError) => {
        console.warn(
          `Failed to disconnect browser after setup failure: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`,
        );
      });
    }
    if (stopAppServer) {
      await stopAppServer();
    }
    throw error;
  }
}

export async function openBrowserPage(argv = [], options = {}) {
  const { page } = await openBrowserSession(argv, {
    ...options,
    autoStartServer: false,
  });
  return page;
}

export async function closeBrowserSession(session) {
  try {
    if (session?.page) {
      await disconnectBrowser(session.page);
    }
  } finally {
    if (session?.stopAppServer) {
      await session.stopAppServer();
    }
  }
}
