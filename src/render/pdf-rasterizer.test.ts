import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Mock pdfjs-dist before importing the module under test.
// jsdom has no real PDF rendering, so we mock the entire library.

const mockRenderPromise = Promise.resolve();
const mockRender = vi.fn(() => ({ promise: mockRenderPromise }));
const mockCleanup = vi.fn();
const mockGetViewport = vi.fn((opts: { scale: number }) => ({
  width: 600 * opts.scale,
  height: 800 * opts.scale,
}));
const mockGetPage = vi.fn(() =>
  Promise.resolve({
    getViewport: mockGetViewport,
    render: mockRender,
    cleanup: mockCleanup,
  }),
);
const mockDestroy = vi.fn(() => Promise.resolve());
const mockGetDocument = vi.fn(() => ({
  promise: Promise.resolve({
    numPages: 1,
    getPage: mockGetPage,
    destroy: mockDestroy,
  }),
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: mockGetDocument,
  GlobalWorkerOptions: { workerSrc: "" },
}));

// Import module under test (after vi.mock).
const mod = await import("./pdf-rasterizer");
const { rasterizePdfPage1, canvasAdapter } = mod;

// Stub canvasAdapter.create — jsdom has no canvas 2d context.
const FAKE_DATA_URL = "data:image/png;base64,AAAA";
const origCreate = canvasAdapter.create;

function installCanvasMock() {
  canvasAdapter.create = () => ({
    canvas: null,
    ctx: {} as CanvasRenderingContext2D,
    toDataUrl: async () => FAKE_DATA_URL,
  });
}

describe("rasterizePdfPage1", () => {
  beforeEach(() => {
    mockGetDocument.mockClear();
    mockGetPage.mockClear();
    mockGetViewport.mockClear();
    mockRender.mockClear();
    mockCleanup.mockClear();
    mockDestroy.mockClear();
    installCanvasMock();
  });

  // Restore original after all tests.
  afterAll(() => {
    canvasAdapter.create = origCreate;
  });

  it("is an async function that accepts Uint8Array and returns a string", () => {
    expect(typeof rasterizePdfPage1).toBe("function");
  });

  it("returns a data URL string on success", async () => {
    const fakeData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const result = await rasterizePdfPage1(fakeData);
    expect(typeof result).toBe("string");
    expect(result).toContain("data:image/png");
  });

  it("calls getDocument with the provided data", async () => {
    const fakeData = new Uint8Array([1, 2, 3]);
    await rasterizePdfPage1(fakeData);
    expect(mockGetDocument).toHaveBeenCalledWith({ data: fakeData });
  });

  it("requests page 1", async () => {
    await rasterizePdfPage1(new Uint8Array([1]));
    expect(mockGetPage).toHaveBeenCalledWith(1);
  });

  it("cleans up page and destroys document after rendering", async () => {
    await rasterizePdfPage1(new Uint8Array([1]));
    expect(mockCleanup).toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("uses default maxWidth of 1200", async () => {
    await rasterizePdfPage1(new Uint8Array([1]));
    // The page is 600 wide at scale=1, so scale = min(1200/600, 1) = 1
    expect(mockGetViewport).toHaveBeenCalledWith({ scale: 1 });
  });

  it("respects custom maxWidth", async () => {
    await rasterizePdfPage1(new Uint8Array([1]), { maxWidth: 300 });
    // Page is 600 wide, so scale = min(300/600, 1) = 0.5
    expect(mockGetViewport).toHaveBeenLastCalledWith({ scale: 0.5 });
  });

  it("respects custom maxHeight", async () => {
    await rasterizePdfPage1(new Uint8Array([1]), {
      maxWidth: 1200,
      maxHeight: 400,
    });
    // Page is 800 tall at scale=1. heightScale = 400/800 = 0.5, widthScale = 1200/600 = 2 -> capped at 1
    // final scale = min(1, 0.5) = 0.5
    expect(mockGetViewport).toHaveBeenLastCalledWith({ scale: 0.5 });
  });

  it("never upscales beyond 1:1", async () => {
    await rasterizePdfPage1(new Uint8Array([1]), { maxWidth: 2400 });
    // widthScale = 2400/600 = 4, but capped to 1
    expect(mockGetViewport).toHaveBeenLastCalledWith({ scale: 1 });
  });

  describe("error handling", () => {
    it("returns empty string when getDocument fails", async () => {
      const rejected = Promise.reject(new Error("corrupt PDF"));
      rejected.catch(() => {}); // prevent unhandled rejection warning
      mockGetDocument.mockReturnValueOnce({ promise: rejected });
      const result = await rasterizePdfPage1(new Uint8Array([0xff]));
      expect(result).toBe("");
    });

    it("returns empty string when getPage fails", async () => {
      mockGetPage.mockRejectedValueOnce(new Error("no page 1"));
      const result = await rasterizePdfPage1(new Uint8Array([1]));
      expect(result).toBe("");
    });

    it("returns empty string when render fails", async () => {
      const rejected = Promise.reject(new Error("render failed"));
      rejected.catch(() => {}); // prevent unhandled rejection warning
      mockRender.mockReturnValueOnce({ promise: rejected });
      const result = await rasterizePdfPage1(new Uint8Array([1]));
      expect(result).toBe("");
    });

    it("still destroys document on render failure", async () => {
      const rejected = Promise.reject(new Error("render failed"));
      rejected.catch(() => {}); // prevent unhandled rejection warning
      mockRender.mockReturnValueOnce({ promise: rejected });
      await rasterizePdfPage1(new Uint8Array([1]));
      expect(mockDestroy).toHaveBeenCalled();
    });

    it("returns empty string for empty input", async () => {
      const rejected = Promise.reject(new Error("empty data"));
      rejected.catch(() => {}); // prevent unhandled rejection warning
      mockGetDocument.mockReturnValueOnce({ promise: rejected });
      const result = await rasterizePdfPage1(new Uint8Array([]));
      expect(result).toBe("");
    });
  });
});
