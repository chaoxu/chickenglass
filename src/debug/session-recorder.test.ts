import { describe, expect, it } from "vitest";
import type { DebugRenderState } from "../editor";
import {
  _compactDebugContextForEventForTest as compactDebugContextForEvent,
  _sanitizeDebugEventDetailForTest as sanitizeDebugEventDetail,
} from "./session-recorder";

const renderState: DebugRenderState = {
  renderedBlockHeaders: 1,
  inlineMath: 2,
  displayMath: 3,
  citations: 4,
  crossrefs: 5,
  tables: 6,
  figures: 7,
  visibleRawFencedOpeners: [],
};

describe("session-recorder capture policy", () => {
  it("drops heavy render context for scroll events", () => {
    const compacted = compactDebugContextForEvent("scroll", {
      document: {
        path: "index.md",
        name: "index.md",
        dirty: false,
      },
      mode: "rich",
      selection: {
        head: 12,
      },
      render: renderState,
      location: "http://localhost:5173/",
    });

    expect(compacted).toEqual({
      document: {
        path: "index.md",
        name: "index.md",
        dirty: false,
      },
      mode: "rich",
      selection: null,
      render: null,
      location: "http://localhost:5173/",
    });
  });

  it("keeps render context for pointer events", () => {
    const compacted = compactDebugContextForEvent("pointer", {
      document: null,
      mode: "rich",
      selection: null,
      render: renderState,
      location: "http://localhost:5173/",
    });

    expect(compacted?.render).toEqual(renderState);
  });

  it("trims large doc-change inserts to preview + length", () => {
    const detail = sanitizeDebugEventDetail("doc", {
      userEvent: "input.type",
      changes: [
        {
          fromA: 0,
          toA: 0,
          fromB: 0,
          toB: 140,
          inserted: "x".repeat(140),
        },
      ],
    }) as {
      changes: Array<Record<string, unknown>>;
    };

    expect(detail.changes).toHaveLength(1);
    expect(detail.changes[0]).not.toHaveProperty("inserted");
    expect(detail.changes[0]).toMatchObject({
      insertedLength: 140,
      insertedPreview: "x".repeat(117) + "...",
    });
  });

  it("summarizes large app payloads without embedding full contents", () => {
    const detail = sanitizeDebugEventDetail("app", {
      name: "fixture.md",
      content: "alpha beta gamma",
      files: [
        {
          path: "demo/index.md",
          kind: "text",
          content: "hello world",
        },
        {
          path: "demo/image.png",
          kind: "binary",
          base64: "abc123",
        },
      ],
    }) as {
      contentLength?: number;
      contentPreview?: string;
      content?: string;
      files: Array<Record<string, unknown>>;
    };

    expect(detail.content).toBeUndefined();
    expect(detail.contentLength).toBe(16);
    expect(detail.contentPreview).toBe("alpha beta gamma");
    expect(detail.files[0]).toMatchObject({
      path: "demo/index.md",
      kind: "text",
      contentLength: 11,
    });
    expect(detail.files[0]).not.toHaveProperty("content");
    expect(detail.files[1]).toMatchObject({
      path: "demo/image.png",
      kind: "binary",
      base64Length: 6,
    });
    expect(detail.files[1]).not.toHaveProperty("base64");
  });
});
