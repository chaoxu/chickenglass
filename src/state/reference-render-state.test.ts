import { describe, expect, it } from "vitest";
import {
  citationDataChanged,
  footnoteDataChanged,
  getReferenceRenderSignature,
  referenceIndexChanged,
  referenceRenderDependenciesChanged,
  type ReferenceRenderDependencies,
} from "./reference-render-state";

function makeDeps(overrides?: Partial<ReferenceRenderDependencies>): ReferenceRenderDependencies {
  return {
    renderIndex: {
      references: new Map(),
      footnotes: new Map(),
    },
    footnoteDefinitions: new Map(),
    citations: {
      citedIds: [],
      backlinks: new Map(),
      store: new Map(),
    },
    labelGraph: {
      definitions: [],
      definitionsById: new Map(),
      uniqueDefinitionById: new Map(),
      duplicatesById: new Map(),
      references: [],
      referencesByTarget: new Map(),
    },
    ...overrides,
  };
}

describe("referenceRenderDependenciesChanged", () => {
  it("returns false for same references", () => {
    const deps = makeDeps();
    expect(referenceRenderDependenciesChanged(deps, deps)).toBe(false);
  });

  it("detects renderIndex change", () => {
    const a = makeDeps();
    const b = makeDeps({ renderIndex: { ...a.renderIndex } });
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });

  it("detects citations change", () => {
    const a = makeDeps();
    const b = makeDeps({ citations: { ...a.citations } });
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });

  it("detects footnoteDefinitions change", () => {
    const a = makeDeps();
    const b = makeDeps({ footnoteDefinitions: new Map([["fn1", "text"]]) });
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });

  it("detects labelGraph change", () => {
    const a = makeDeps();
    const b = makeDeps({ labelGraph: { ...a.labelGraph } });
    expect(referenceRenderDependenciesChanged(a, b)).toBe(true);
  });
});

describe("referenceIndexChanged", () => {
  it("returns false for same renderIndex", () => {
    const deps = makeDeps();
    expect(referenceIndexChanged(deps, deps)).toBe(false);
  });

  it("detects renderIndex change", () => {
    const a = makeDeps();
    const b = makeDeps({ renderIndex: { ...a.renderIndex } });
    expect(referenceIndexChanged(a, b)).toBe(true);
  });

  it("ignores citation change", () => {
    const a = makeDeps();
    const b = { ...a, citations: { ...a.citations } };
    expect(referenceIndexChanged(a, b)).toBe(false);
  });
});

describe("citationDataChanged", () => {
  it("returns false for same citations", () => {
    const deps = makeDeps();
    expect(citationDataChanged(deps, deps)).toBe(false);
  });

  it("detects citations change", () => {
    const a = makeDeps();
    const b = makeDeps({ citations: { ...a.citations } });
    expect(citationDataChanged(a, b)).toBe(true);
  });

  it("ignores renderIndex change", () => {
    const a = makeDeps();
    const b = { ...a, renderIndex: { ...a.renderIndex } };
    expect(citationDataChanged(a, b)).toBe(false);
  });
});

describe("footnoteDataChanged", () => {
  it("returns false for same footnote data", () => {
    const deps = makeDeps();
    expect(footnoteDataChanged(deps, deps)).toBe(false);
  });

  it("detects footnoteDefinitions change", () => {
    const a = makeDeps();
    const b = makeDeps({ footnoteDefinitions: new Map([["fn1", "text"]]) });
    expect(footnoteDataChanged(a, b)).toBe(true);
  });

  it("detects renderIndex.footnotes change", () => {
    const a = makeDeps();
    const b = makeDeps({
      renderIndex: { ...a.renderIndex, footnotes: new Map([["fn1", 1]]) },
    });
    expect(footnoteDataChanged(a, b)).toBe(true);
  });

  it("ignores citation change", () => {
    const a = makeDeps();
    const b = { ...a, citations: { ...a.citations } };
    expect(footnoteDataChanged(a, b)).toBe(false);
  });
});

describe("getReferenceRenderSignature", () => {
  it("returns deterministic signature", () => {
    const deps = makeDeps();
    expect(getReferenceRenderSignature(deps)).toBe("refs:0,fn:0,fndef:0,cited:0,bkl:0,labels:0");
  });

  it("changes when references added", () => {
    const a = makeDeps();
    const b = makeDeps({
      renderIndex: {
        ...a.renderIndex,
        references: new Map([["ref1", { kind: "heading", label: "Section 1" }]]),
      },
    });
    expect(getReferenceRenderSignature(a)).not.toBe(getReferenceRenderSignature(b));
  });
});
