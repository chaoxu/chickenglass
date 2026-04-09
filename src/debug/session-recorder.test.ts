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

const structureState = {
  kind: "frontmatter",
  from: 0,
  to: 24,
  title: "Demo",
} as const;

describe("session-recorder capture policy", () => {
  it("drops heavy render context for scroll events but keeps structure state", () => {
    const compacted = compactDebugContextForEvent("scroll", {
      document: {
        path: "index.md",
        name: "index.md",
        dirty: false,
      },
      mode: "rich",
      selection: {
        anchor: 12,
        head: 12,
        from: 12,
        to: 12,
        empty: true,
        line: 1,
        col: 13,
      },
      render: renderState,
      structure: structureState,
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
      structure: structureState,
      location: "http://localhost:5173/",
    });
  });

  it("keeps render context for pointer events", () => {
    const compacted = compactDebugContextForEvent("pointer", {
      document: null,
      mode: "rich",
      selection: null,
      render: renderState,
      structure: structureState,
      location: "http://localhost:5173/",
    });

    expect(compacted?.render).toEqual(renderState);
    expect(compacted?.structure).toEqual(structureState);
  });

  it("keeps full capture context for snapshot events", () => {
    const compacted = compactDebugContextForEvent("snapshot", {
      document: null,
      mode: "rich",
      selection: {
        anchor: 4,
        head: 7,
        from: 4,
        to: 7,
        empty: false,
        line: 1,
        col: 5,
      },
      render: renderState,
      structure: structureState,
      location: "http://localhost:5173/",
    });

    expect(compacted).toMatchObject({
      render: renderState,
      structure: structureState,
      selection: {
        anchor: 4,
        head: 7,
      },
    });
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
