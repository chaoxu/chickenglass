import type { EditorState } from "@codemirror/state";
import type { SpecialBehavior } from "../constants/block-manifest";
import type { FencedDivInfo } from "../fenced-block/model";
import { DecorationBuilder } from "./decoration-builder";

export interface SpecialBehaviorContext {
  readonly state: EditorState;
  readonly div: FencedDivInfo;
  readonly builder: DecorationBuilder;
  readonly openLine: { readonly to: number };
  readonly activeShell: boolean;
  readonly openerSourceActive: boolean;
}

export type SpecialBehaviorHandler = (context: SpecialBehaviorContext) => void;

const noopSpecialBehavior: SpecialBehaviorHandler = () => {};

const specialBehaviorHandlers: Readonly<Record<SpecialBehavior, SpecialBehaviorHandler>> = {
  blockquote: noopSpecialBehavior,
  qed: ({ state, div, builder }) => {
    builder.addQedDecoration(state, div);
  },
};

export function applySpecialBehavior(
  specialBehavior: SpecialBehavior | undefined,
  context: SpecialBehaviorContext,
): void {
  if (!specialBehavior) return;
  specialBehaviorHandlers[specialBehavior](context);
}
