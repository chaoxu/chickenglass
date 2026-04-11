export type FocusOwnerRole =
  | "embedded-field"
  | "rich-surface"
  | "source-bridge"
  | "source-surface";

export type FocusOwner =
  | { readonly kind: "none" }
  | {
      readonly kind: "surface";
      readonly namespace: string;
      readonly role: FocusOwnerRole;
    };

export type SurfaceFocusOwner = Extract<FocusOwner, { readonly kind: "surface" }>;

export const FOCUS_NONE: FocusOwner = { kind: "none" };

export function focusSurface(
  role: FocusOwnerRole,
  namespace: string,
): SurfaceFocusOwner {
  return {
    kind: "surface",
    namespace,
    role,
  };
}

export function isSameFocusOwner(
  a: FocusOwner,
  b: FocusOwner,
): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "surface" && b.kind === "surface") {
    return a.namespace === b.namespace && a.role === b.role;
  }
  return true;
}

export function setFocusOwner(
  current: FocusOwner,
  next: FocusOwner,
): FocusOwner {
  return isSameFocusOwner(current, next) ? current : next;
}

export function clearFocusOwner(
  current: FocusOwner,
): FocusOwner {
  return current.kind === "none" ? current : FOCUS_NONE;
}

export function clearFocusOwnerIfMatch(
  current: FocusOwner,
  next: FocusOwner,
): FocusOwner {
  return isSameFocusOwner(current, next) ? clearFocusOwner(current) : current;
}
