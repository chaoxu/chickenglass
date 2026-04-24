export interface CoflatProductConfig {
  readonly id: "coflats";
  readonly displayName: string;
  readonly description: string;
}

export const activeCoflatProduct: CoflatProductConfig = {
  id: "coflats",
  displayName: "Coflat",
  description: "Semantic document editor for mathematical writing.",
};
