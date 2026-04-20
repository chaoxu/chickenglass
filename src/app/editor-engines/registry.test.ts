import { describe, expect, it } from "vitest";

import { COFLAT_PRODUCTS } from "../../product";
import { getEditorEngineReadiness } from "./registry";

describe("editor engine readiness registry", () => {
  it("marks the current Coflat CM6 editor as integrated", () => {
    expect(getEditorEngineReadiness(COFLAT_PRODUCTS.coflat.editorEngine)).toMatchObject({
      id: "cm6-markdown",
      integrated: true,
      sourceOwner: "coflat",
    });
  });

  it("marks the Coflat 2 Lexical editor as integrated", () => {
    expect(getEditorEngineReadiness(COFLAT_PRODUCTS.coflat2.editorEngine)).toMatchObject({
      id: "lexical-wysiwyg",
      integrated: true,
      sourceOwner: "coflat2",
    });
  });
});
