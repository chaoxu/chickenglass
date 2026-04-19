import { describe, expect, it, vi } from "vitest";

import {
  assertAppUrl,
  formatAppUrlProbeFailure,
  probeAppUrl,
} from "./http.mjs";

describe("app URL readiness helpers", () => {
  it("returns a result object after retrying transient fetch failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await probeAppUrl("http://localhost:5173", {
      fetchImpl,
      intervalMs: 0,
      timeout: 100,
    });

    expect(result).toMatchObject({
      ok: true,
      url: "http://localhost:5173",
      status: 200,
      attempts: 2,
    });
  });

  it("treats non-5xx HTTP responses as reachable app responses", async () => {
    const result = await probeAppUrl("http://localhost:5173/missing", {
      fetchImpl: vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
      timeout: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 404,
    });
  });

  it("reports timeout diagnostics for HTTP 5xx responses", async () => {
    const result = await probeAppUrl("http://localhost:5173", {
      fetchImpl: vi.fn().mockResolvedValue(new Response("down", { status: 503 })),
      timeout: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      attempts: 1,
    });
    expect(formatAppUrlProbeFailure(result)).toContain("last status=503");
  });

  it("provides the throwing contract for callers that require readiness", async () => {
    await expect(assertAppUrl("http://localhost:5173", {
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
      timeout: 0,
    })).rejects.toThrow(/last error=offline/);
  });
});
