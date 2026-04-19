import { setTimeout as sleep } from "node:timers/promises";

function now() {
  return Date.now();
}

function formatProbeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function responseIsAppReachable(response) {
  return response.ok || response.status < 500;
}

export function formatAppUrlProbeFailure(result) {
  if (result.ok) {
    return `${result.url} is reachable`;
  }
  const status = result.status ? `; last status=${result.status}` : "";
  const error = result.error ? `; last error=${result.error}` : "";
  return `Timed out waiting for app URL ${result.url}${status}${error}`;
}

export async function probeAppUrl(
  url,
  {
    timeout = 15000,
    intervalMs = 250,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const startedAt = now();
  let attempts = 0;
  let lastStatus = null;
  let lastError = null;

  while (true) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
      });
      lastStatus = response.status;
      lastError = null;
      if (responseIsAppReachable(response)) {
        return {
          ok: true,
          url,
          status: response.status,
          attempts,
          elapsedMs: now() - startedAt,
        };
      }
    } catch (error) {
      lastError = formatProbeError(error);
    }

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeout) {
      return {
        ok: false,
        url,
        status: lastStatus,
        error: lastError,
        attempts,
        elapsedMs,
      };
    }

    await sleep(Math.min(intervalMs, timeout - elapsedMs));
  }
}

export async function assertAppUrl(url, options = {}) {
  const result = await probeAppUrl(url, options);
  if (!result.ok) {
    throw new Error(formatAppUrlProbeFailure(result));
  }
  return result;
}
