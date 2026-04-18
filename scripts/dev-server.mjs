import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export async function waitForAppUrl(
  url,
  { timeout = 15000, intervalMs = 250 } = {},
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
      });
      if (response.ok || response.status < 500) {
        return true;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(intervalMs);
  }

  return false;
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function findAvailablePort(startPort = 5173, maxAttempts = 30) {
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found from ${startPort} to ${startPort + maxAttempts - 1}.`);
}

export async function startOrReuseDevServer({
  cwd = process.cwd(),
  preferredPort = 5173,
  timeout = 20000,
  url,
} = {}) {
  if (url) {
    if (!(await waitForAppUrl(url, { timeout }))) {
      throw new Error(`App URL is not reachable: ${url}`);
    }
    return {
      reused: true,
      url,
      stop: async () => {},
    };
  }

  const defaultUrl = `http://localhost:${preferredPort}`;
  if (await waitForAppUrl(defaultUrl, { timeout: 750 })) {
    return {
      reused: true,
      url: defaultUrl,
      stop: async () => {},
    };
  }

  const port = await findAvailablePort(preferredPort);
  const nextUrl = `http://localhost:${port}`;
  const child = spawn(
    "pnpm",
    ["dev", "--", "--host", "localhost", "--port", String(port), "--strictPort"],
    {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk) => {
    output += chunk.toString();
    if (output.length > 8000) {
      output = output.slice(-8000);
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  let readyComplete = false;
  const stopped = new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (readyComplete) {
        resolve();
        return;
      }
      reject(new Error(`Vite dev server exited before it was ready (code=${code ?? "null"}, signal=${signal ?? "null"}).\n${output}`));
    });
  });
  const ready = (async () => {
    if (!(await waitForAppUrl(nextUrl, { timeout }))) {
      throw new Error(`Timed out waiting for dev server at ${nextUrl}.\n${output}`);
    }
  })();

  await Promise.race([ready, stopped]);
  readyComplete = true;

  return {
    reused: false,
    url: nextUrl,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        sleep(1500).then(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }),
      ]);
    },
  };
}
