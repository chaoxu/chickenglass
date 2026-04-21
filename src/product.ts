export interface CoflatsProductConfig {
  readonly id: "coflats";
  readonly displayName: string;
  readonly description: string;
}

export const activeCoflatProduct: CoflatsProductConfig = {
  id: "coflats",
  displayName: "Coflats",
  description: "Semantic document editor for mathematical writing.",
};
