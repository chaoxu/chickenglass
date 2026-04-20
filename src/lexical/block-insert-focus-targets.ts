import type {
  StructureBlockVariant,
  StructureEditSurface,
} from "../state/structure-edit";
import type {
  PendingEmbeddedSurfaceFocusTarget,
  PendingSurfaceFocusRequest,
} from "./pending-surface-focus";

export type InsertFocusTarget =
  | "block-body"
  | "display-math"
  | "footnote-body"
  | "frontmatter"
  | "none"
  | "table-cell";

export type InsertFocusActivation =
  | { readonly kind: "none" }
  | {
      readonly kind: "dom-selector";
      readonly selector: string;
    }
  | {
      readonly kind: "structure-edit";
      readonly surface: StructureEditSurface;
      readonly variant: StructureBlockVariant;
    }
  | { readonly kind: "table-cell" };

export interface InsertFocusBehavior {
  readonly activation: InsertFocusActivation;
  readonly pendingFocus?: {
    readonly request: PendingSurfaceFocusRequest;
    readonly target: PendingEmbeddedSurfaceFocusTarget;
  };
}

const INSERT_FOCUS_BEHAVIOR = {
  "block-body": {
    activation: { kind: "none" },
    pendingFocus: { request: "end", target: "block-body" },
  },
  "display-math": {
    activation: {
      kind: "structure-edit",
      surface: "display-math-source",
      variant: "display-math",
    },
    pendingFocus: { request: "start", target: "structure-source" },
  },
  "footnote-body": {
    activation: { kind: "none" },
    pendingFocus: { request: "end", target: "footnote-body" },
  },
  "frontmatter": {
    activation: {
      kind: "structure-edit",
      surface: "frontmatter-source",
      variant: "frontmatter",
    },
    pendingFocus: { request: "start", target: "structure-source" },
  },
  none: {
    activation: { kind: "none" },
  },
  "table-cell": {
    activation: { kind: "table-cell" },
  },
} satisfies Record<InsertFocusTarget, InsertFocusBehavior>;

export function getInsertFocusBehavior(
  target: InsertFocusTarget,
): InsertFocusBehavior {
  return INSERT_FOCUS_BEHAVIOR[target];
}
