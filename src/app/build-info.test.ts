import { describe, expect, it } from "vitest";
import { formatBuildCommitTime, resolveBuildInfo } from "./build-info";

describe("build info formatting", () => {
  it("formats ISO commit timestamps as a short status-bar label", () => {
    expect(formatBuildCommitTime("2026-04-05T12:31:00Z", { timeZone: "UTC" })).toBe("Apr 5 12:31");
  });

  it("rejects invalid timestamps instead of rendering broken UI", () => {
    expect(formatBuildCommitTime("not-a-date")).toBeNull();
  });

  it("combines the short hash and formatted timestamp into a badge label", () => {
    expect(resolveBuildInfo("00f0789", "2026-04-05T12:31:00Z", { timeZone: "UTC" })).toEqual({
      hash: "00f0789",
      commitTime: "2026-04-05T12:31:00Z",
      label: "00f0789 · Apr 5 12:31",
      title: "00f0789 - 2026-04-05T12:31:00Z",
    });
  });

  it("hides the badge when either build metadata field is missing", () => {
    expect(resolveBuildInfo("", "2026-04-05T12:31:00Z")).toBeNull();
    expect(resolveBuildInfo("00f0789", "")).toBeNull();
  });
});
