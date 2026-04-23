import type { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { documentSemanticsField } from "../../state/document-analysis";
import { mathMacrosField } from "../../state/math-macros";
import { computeSidenoteInvalidation } from "./sidenote-invalidation";

function createFieldReader(values: {
  readonly semantics?: unknown;
  readonly macros?: Record<string, string> | undefined;
}): EditorState {
  return {
    field(requestedField: unknown) {
      if (requestedField === documentSemanticsField) {
        return values.semantics;
      }
      if (requestedField === mathMacrosField) {
        return values.macros;
      }
      return undefined;
    },
  } as unknown as EditorState;
}

function createChangedRanges(fromB: number): {
  iterChangedRanges(
    callback: (fromA: number, toA: number, nextFrom: number, nextTo: number) => void,
  ): void;
} {
  return {
    iterChangedRanges(callback) {
      callback(fromB, fromB, fromB, fromB);
    },
  };
}

describe("computeSidenoteInvalidation", () => {
  it("ignores same-height typing after the last footnote reference", () => {
    const semantics = {
      footnotes: {
        refs: [{ from: 10 }, { from: 20 }],
      },
    };

    expect(computeSidenoteInvalidation({
      startState: createFieldReader({ semantics }),
      state: createFieldReader({ semantics }),
      heightChanged: false,
      docChanged: true,
      changes: createChangedRanges(25),
    })).toBeNull();
  });

  it("treats height changes as global sidenote layout invalidation", () => {
    const semantics = { footnotes: { refs: [] } };

    expect(computeSidenoteInvalidation({
      startState: createFieldReader({ semantics }),
      state: createFieldReader({ semantics }),
      heightChanged: true,
    })).toEqual({
      footnotesChanged: false,
      macrosChanged: false,
      globalLayoutChanged: true,
      layoutChangeFrom: -1,
    });
  });

  it("invalidates from the earliest changed position when later footnote refs can move", () => {
    const semantics = {
      footnotes: {
        refs: [{ from: 10 }, { from: 20 }],
      },
    };

    expect(computeSidenoteInvalidation({
      startState: createFieldReader({ semantics }),
      state: createFieldReader({ semantics }),
      heightChanged: false,
      docChanged: true,
      changes: createChangedRanges(15),
    })).toEqual({
      footnotesChanged: false,
      macrosChanged: false,
      globalLayoutChanged: false,
      layoutChangeFrom: 15,
    });
  });

  it("invalidates when footnotes or macros change", () => {
    expect(computeSidenoteInvalidation({
      startState: createFieldReader({
        semantics: { footnotes: { refs: [] } },
        macros: { "\\A": "\\alpha" },
      }),
      state: createFieldReader({
        semantics: { footnotes: { refs: [{ id: "note-1" }] } },
        macros: { "\\A": "\\alpha", "\\B": "\\beta" },
      }),
      heightChanged: false,
    })).toEqual({
      footnotesChanged: true,
      macrosChanged: true,
      globalLayoutChanged: false,
      layoutChangeFrom: -1,
    });
  });
});
