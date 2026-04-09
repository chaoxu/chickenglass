type DebugRenderFlag =
  | "disableInlineMathWidgets"
  | "disableDisplayMathWidgets"
  | "disableReferenceWidgets";

type DebugRenderFlagState = Partial<Record<DebugRenderFlag, boolean>>;

function getDebugRenderFlags(): DebugRenderFlagState {
  const candidate = (globalThis as { __cfDebugRenderFlags?: unknown }).__cfDebugRenderFlags;
  if (!candidate || typeof candidate !== "object") return {};
  return candidate as DebugRenderFlagState;
}

export function isDebugRenderFlagEnabled(flag: DebugRenderFlag): boolean {
  return getDebugRenderFlags()[flag] === true;
}
