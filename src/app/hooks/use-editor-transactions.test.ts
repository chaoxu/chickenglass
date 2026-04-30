import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useEditorTransactions } from "./use-editor-transactions";

interface HarnessRef {
  result: ReturnType<typeof useEditorTransactions>;
}

function createHarness(): { readonly Harness: FC; readonly ref: HarnessRef } {
  const ref: HarnessRef = {
    result: null as unknown as ReturnType<typeof useEditorTransactions>,
  };
  const Harness: FC = () => {
    ref.result = useEditorTransactions();
    return null;
  };
  return { Harness, ref };
}

describe("useEditorTransactions", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("runs the body and returns intent + value", () => {
    const { Harness, ref } = createHarness();
    act(() => {
      root.render(createElement(Harness));
    });

    const result = ref.result.runEditorTransaction("save", () => 42);
    expect(result.intent).toBe("save");
    expect(result.value).toBe(42);
  });
});
