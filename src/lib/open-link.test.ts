import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { openExternalUrl, handleExternalLinkClick } from "./open-link";
import { isTauri } from "./tauri";

// Mock isTauri — default to false (browser mode)
vi.mock("./tauri", () => ({ isTauri: vi.fn(() => false) }));

// Mock the perf module so the Tauri path can be exercised without a real backend.
vi.mock("../app/perf", () => ({
  invokeWithPerf: vi.fn(() => Promise.resolve()),
}));

describe("openExternalUrl", () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    windowOpenSpy.mockRestore();
  });

  it("opens http URL via window.open in browser mode", async () => {
    const result = await openExternalUrl("https://example.com");
    expect(result).toBe(true);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens http:// URL", async () => {
    const result = await openExternalUrl("http://example.com");
    expect(result).toBe(true);
    expect(windowOpenSpy).toHaveBeenCalled();
  });

  it("rejects empty URL", async () => {
    expect(await openExternalUrl("")).toBe(false);
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it("rejects javascript: URL", async () => {
    expect(await openExternalUrl("javascript:alert(1)")).toBe(false);
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it("rejects mailto: URL (not http/https)", async () => {
    expect(await openExternalUrl("mailto:user@example.com")).toBe(false);
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it("rejects relative path", async () => {
    expect(await openExternalUrl("foo/bar")).toBe(false);
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it("rejects fragment-only URL", async () => {
    expect(await openExternalUrl("#section")).toBe(false);
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });
});

describe("openExternalUrl (Tauri mode)", () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
    windowOpenSpy.mockRestore();
  });

  it("calls invokeWithPerf('open_url') instead of window.open", async () => {
    const { invokeWithPerf } = await import("../app/perf");
    const result = await openExternalUrl("https://example.com");
    expect(result).toBe(true);
    expect(invokeWithPerf).toHaveBeenCalledWith("open_url", { url: "https://example.com" });
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it("returns false and does not throw when invokeWithPerf rejects", async () => {
    const { invokeWithPerf } = await import("../app/perf");
    vi.mocked(invokeWithPerf).mockRejectedValueOnce(new Error("backend down"));
    const result = await openExternalUrl("https://example.com");
    expect(result).toBe(false);
    expect(windowOpenSpy).not.toHaveBeenCalled();
  });
});

describe("handleExternalLinkClick", () => {
  function makeAnchorClick(href: string): { event: MouseEvent; anchor: HTMLAnchorElement } {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", href);
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: anchor, writable: false });
    return { event, anchor };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prevents default and returns true for external link", () => {
    const { event } = makeAnchorClick("https://example.com");
    const result = handleExternalLinkClick(event);
    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("allows fragment-only links through (returns false)", () => {
    const { event } = makeAnchorClick("#fn-1");
    const result = handleExternalLinkClick(event);
    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("prevents default for relative path links", () => {
    const { event } = makeAnchorClick("images/photo.png");
    const result = handleExternalLinkClick(event);
    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("returns false when target is not inside an anchor", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: div, writable: false });
    expect(handleExternalLinkClick(event)).toBe(false);
  });

  it("returns false when anchor has no href", () => {
    const anchor = document.createElement("a");
    document.body.appendChild(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: anchor, writable: false });
    expect(handleExternalLinkClick(event)).toBe(false);
  });

  it("handles click on child element inside anchor", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://example.com");
    const span = document.createElement("span");
    span.textContent = "link text";
    anchor.appendChild(span);
    document.body.appendChild(anchor);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: span, writable: false });
    const result = handleExternalLinkClick(event);
    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});
