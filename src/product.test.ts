import { describe, expect, it } from "vitest";

import {
  COFLAT_PRODUCTS,
  resolveCoflatProduct,
} from "./product";

describe("Coflat product config", () => {
  it("defaults to Coflat", () => {
    expect(resolveCoflatProduct(undefined)).toBe(COFLAT_PRODUCTS.coflat);
    expect(resolveCoflatProduct("unknown")).toBe(COFLAT_PRODUCTS.coflat);
  });

  it("resolves the Coflat 2 product", () => {
    expect(resolveCoflatProduct("coflat2")).toMatchObject({
      displayName: "Coflat 2",
      editorEngine: "lexical-wysiwyg",
    });
  });
});
