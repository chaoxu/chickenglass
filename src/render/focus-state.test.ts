import { describe, expect, it } from "vitest";
import { StateEffect } from "@codemirror/state";
import { createBooleanToggleField } from "./focus-state";
import { applyStateEffects, createEditorState } from "../test-utils";

describe("createBooleanToggleField", () => {
  it("starts with the initial value (default false)", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", { extensions: field });
    expect(state.field(field)).toBe(false);
  });

  it("starts with custom initial value", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect, true);
    const state = createEditorState("", { extensions: field });
    expect(state.field(field)).toBe(true);
  });

  it("updates to true when effect dispatched with true", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", { extensions: field });
    const updated = applyStateEffects(state, effect.of(true));
    expect(updated.field(field)).toBe(true);
  });

  it("updates to false when effect dispatched with false", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect, true);
    const state = createEditorState("", { extensions: field });
    expect(state.field(field)).toBe(true);
    const updated = applyStateEffects(state, effect.of(false));
    expect(updated.field(field)).toBe(false);
  });

  it("preserves value when unrelated effect is dispatched", () => {
    const effect = StateEffect.define<boolean>();
    const otherEffect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", { extensions: field });
    const updated = applyStateEffects(state, otherEffect.of(true));
    expect(updated.field(field)).toBe(false);
  });

  it("takes first matching effect when multiple are dispatched", () => {
    const effect = StateEffect.define<boolean>();
    const field = createBooleanToggleField(effect);
    const state = createEditorState("", { extensions: field });
    const updated = applyStateEffects(state, [
      effect.of(true),
      effect.of(false),
    ]);
    expect(updated.field(field)).toBe(true);
  });
});
