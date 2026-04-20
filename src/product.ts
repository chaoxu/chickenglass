export const COFLAT_PRODUCT_IDS = ["coflat", "coflat2"] as const;

export type CoflatProductId = (typeof COFLAT_PRODUCT_IDS)[number];

export type CoflatEditorEngine = "cm6-markdown" | "lexical-wysiwyg";

export interface CoflatProductConfig {
  readonly id: CoflatProductId;
  readonly displayName: string;
  readonly description: string;
  readonly editorEngine: CoflatEditorEngine;
}

export const COFLAT_PRODUCTS: Readonly<Record<CoflatProductId, CoflatProductConfig>> = {
  coflat: {
    id: "coflat",
    displayName: "Coflat",
    description: "Semantic document editor for mathematical writing.",
    editorEngine: "cm6-markdown",
  },
  coflat2: {
    id: "coflat2",
    displayName: "Coflat 2",
    description: "WYSIWYG semantic document editor for mathematical writing.",
    editorEngine: "lexical-wysiwyg",
  },
};

export function isCoflatProductId(value: unknown): value is CoflatProductId {
  return typeof value === "string" && COFLAT_PRODUCT_IDS.includes(value as CoflatProductId);
}

export function resolveCoflatProduct(value: unknown): CoflatProductConfig {
  return isCoflatProductId(value) ? COFLAT_PRODUCTS[value] : COFLAT_PRODUCTS.coflat;
}

export const activeCoflatProduct = resolveCoflatProduct(
  import.meta.env.VITE_COFLAT_PRODUCT,
);
