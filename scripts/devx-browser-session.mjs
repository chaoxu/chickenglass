import console from "node:console";
import { createBrowserArtifactRecorder } from "./browser-failure-artifacts.mjs";
import { runBrowserDoctor } from "./browser-health.mjs";
import {
  connectEditor,
  disconnectBrowser,
  ensureAppServer,
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
  const { getFlag, getIntFlag, hasFlag } = createArgParser(argv);
  const chromeArgs = parseChromeArgs(argv, { browser: defaultBrowser });
  const timeout = getIntFlag("--timeout", timeoutFallback);
  const artifactsDir = getFlag("--artifacts-dir", undefined);
  const stopAppServer = await ensureAppServer(chromeArgs.url, {
    autoStart: autoStartServer && !hasFlag("--no-start-server"),
  });
  let page = null;
  let recorder = null;

  try {
    page = await connectEditor({
      browser: chromeArgs.browser,
      headless: chromeArgs.headless,
      port: chromeArgs.port,
      predicate: () => true,
      timeout,
      url: chromeArgs.url,
      waitForBridge: false,
    });
    recorder = createBrowserArtifactRecorder(page);

    if (reloadCdp && chromeArgs.browser === "cdp") {
      await page.reload({ waitUntil: "load" });
    }

    await runBrowserDoctor(page, {
      label: "browser-session",
      targetUrl: chromeArgs.url,
      timeout,
    });
    return {
      artifactRecorder: recorder,
      artifactsRoot: artifactsDir,
      artifactsDir,
      page,
      stopAppServer,
    };
  } catch (error) {
    if (page && recorder) {
      await recorder.collect({
        dispose: true,
        error,
        label: "browser-session-setup",
        root: artifactsDir,
      }).then((artifacts) => {
        console.error(`Browser setup artifacts: ${artifacts.outDir}`);
      }).catch((artifactError) => {
        console.warn(
          `Failed to collect browser setup artifacts: ${artifactError instanceof Error ? artifactError.message : String(artifactError)}`,
        );
      });
    }
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
    session?.artifactRecorder?.dispose?.();
    if (session?.page) {
      await disconnectBrowser(session.page);
    }
  } finally {
    if (session?.stopAppServer) {
      await session.stopAppServer();
    }
  }
}
