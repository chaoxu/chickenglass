import { describe, expect, it } from "vitest";
import {
  citationDataChanged,
  footnoteDataChanged,
  getReferenceRenderDependencies,
  getReferenceRenderSignature,
  referenceIndexChanged,
  referenceRenderDependenciesChanged,
  type ReferenceRenderDependencies,
} from "./reference-render-state";
import type { DocumentLabelGraph } from "../app/markdown/labels";

function makeLabelGraph(partial?: Partial<DocumentLabelGraph>): DocumentLabelGraph {
  return {
    definitions: [],
    definitionsById: new Map(),
    uniqueDefinitionById: new Map(),
    duplicatesById: new Map(),
    references: [],
    referencesByTarget: new Map(),
    ...partial,
  };
}

function makeDeps(overrides?: Partial<ReferenceRenderDependencies>): ReferenceRenderDependencies {
  return {
    renderIndex: {
      references: new Map(),
      footnotes: new Map(),
    },
    footnoteDefinitions: new Map(),
    citations: {
      backlinks: new Map(),
      citedIds: [],
      store: new Map(),
    },
    labelGraph: makeLabelGraph(),
    ...overrides,
  };
}

describe("getReferenceRenderDependencies", () => {
  it("extracts the four reference fields from a context-shaped object", () => {
    const deps = makeDeps();
    const result = getReferenceRenderDependencies(deps);
    expect(result.renderIndex).toBe(deps.renderIndex);
    expect(result.footnoteDefinitions).toBe(deps.footnoteDefinitions);
    expect(result.citations).toBe(deps.citations);
    expect(result.labelGraph).toBe(deps.labelGraph);
  });
});

describe("referenceRenderDependenciesChanged", () => {
  it("returns false when all fields are reference-equal", () => {
    const deps = makeDeps();
    expect(referenceRenderDependenciesChanged(deps, deps)).toBe(false);
  });

  it("detects renderIndex change", () => {
    const a = makeDeps();
    const b = { ...a, renderIndex: { references: new Map(), footnotes: new Map() } };
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });

  it("detects footnoteDefinitions change", () => {
    const a = makeDeps();
    const b = { ...a, footnoteDefinitions: new Map() };
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });

  it("detects citations change", () => {
    const a = makeDeps();
    const b = { ...a, citations: { backlinks: new Map(), citedIds: [], store: new Map() } };
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });

  it("detects labelGraph change", () => {
    const a = makeDeps();
    const b = { ...a, labelGraph: makeLabelGraph() };
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });
});

describe("referenceIndexChanged", () => {
  it("returns false when renderIndex is the same reference", () => {
    const deps = makeDeps();
    expect(referenceIndexChanged(deps, deps)).toBe(false);
  });

  it("detects renderIndex change", () => {
    const a = makeDeps();
    const b = { ...a, renderIndex: { references: new Map(), footnotes: new Map() } };
    expect(referenceIndexChanged(a, b)).toBe(true);
  });

  it("ignores citation change", () => {
    const a = makeDeps();
    const b = { ...a, citations: { backlinks: new Map(), citedIds: [], store: new Map() } };
    expect(referenceIndexChanged(a, b)).toBe(false);
  });
});

describe("citationDataChanged", () => {
  it("returns false when citations is the same reference", () => {
    const deps = makeDeps();
    expect(citationDataChanged(deps, deps)).toBe(false);
  });

  it("detects citations change", () => {
    const a = makeDeps();
    const b = { ...a, citations: { backlinks: new Map(), citedIds: [], store: new Map() } };
    expect(citationDataChanged(a, b)).toBe(true);
  });

  it("ignores renderIndex change", () => {
    const a = makeDeps();
    const b = { ...a, renderIndex: { references: new Map(), footnotes: new Map() } };
    expect(citationDataChanged(a, b)).toBe(false);
  });
});

describe("footnoteDataChanged", () => {
  it("returns false when footnote fields are the same references", () => {
    const deps = makeDeps();
    expect(footnoteDataChanged(deps, deps)).toBe(false);
  });

  it("detects footnoteDefinitions change", () => {
    const a = makeDeps();
    const b = { ...a, footnoteDefinitions: new Map() };
    expect(footnoteDataChanged(a, b)).toBe(true);
  });

  it("detects renderIndex.footnotes change via new renderIndex", () => {
    const a = makeDeps();
    const b = { ...a, renderIndex: { ...a.renderIndex, footnotes: new Map() } };
    expect(footnoteDataChanged(a, b)).toBe(true);
  });

  it("ignores citation change", () => {
    const a = makeDeps();
    const b = { ...a, citations: { backlinks: new Map(), citedIds: [], store: new Map() } };
    expect(footnoteDataChanged(a, b)).toBe(false);
  });
});

describe("getReferenceRenderSignature", () => {
  it("returns a stable string for empty deps", () => {
    const deps = makeDeps();
    const sig = getReferenceRenderSignature(deps);
    expect(sig).toBe("refs:0,fn:0,fndef:0,cited:0,bkl:0,labels:0");
  });

  it("reflects sizes of populated deps", () => {
    const deps = makeDeps({
      renderIndex: {
        references: new Map([["eq:1", { label: "eq:1", number: 1 }]] as [string, unknown][]),
        footnotes: new Map([["fn1", 1]]),
      } as ReferenceRenderDependencies["renderIndex"],
      footnoteDefinitions: new Map([["fn1", "text"]]),
      citations: {
        backlinks: new Map(),
        citedIds: ["cite1", "cite2"],
        store: new Map(),
      } as ReferenceRenderDependencies["citations"],
      labelGraph: makeLabelGraph({
        definitions: [{ id: "eq:1", kind: "equation", from: 0, to: 10, tokenFrom: 0, tokenTo: 10, labelFrom: 0, labelTo: 5, displayLabel: "eq:1" }] as unknown as DocumentLabelGraph["definitions"],
      }),
    });
    const sig = getReferenceRenderSignature(deps);
    expect(sig).toBe("refs:1,fn:1,fndef:1,cited:2,bkl:0,labels:1");
  });

  it("changes when a map grows", () => {
    const deps1 = makeDeps();
    const deps2 = makeDeps({
      footnoteDefinitions: new Map([["fn1", "text"]]),
    });
    expect(getReferenceRenderSignature(deps1)).not.toBe(
      getReferenceRenderSignature(deps2),
    );
  });
});
