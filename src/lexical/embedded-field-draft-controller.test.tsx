import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EmbeddedFieldDraftController,
  type EmbeddedFieldDraftPublishPolicy,
  useEmbeddedFieldDraftController,
} from "./embedded-field-draft-controller";

interface HarnessRef {
  result: EmbeddedFieldDraftController;
}

interface HarnessProps {
  readonly keepPendingAfterImmediatePublish?: boolean;
  readonly onPublish: (value: string) => void;
  readonly publishPolicy: EmbeddedFieldDraftPublishPolicy;
  readonly syncExternalValue?: boolean;
  readonly value: string;
}

function createHarness(initialProps: HarnessProps): {
  readonly Harness: FC;
  readonly ref: HarnessRef;
  readonly setProps: (nextProps: Partial<HarnessProps>) => void;
} {
  const ref: HarnessRef = {
    result: null as unknown as EmbeddedFieldDraftController,
  };
  let props = initialProps;

  const Harness: FC = () => {
    ref.result = useEmbeddedFieldDraftController(props);
    return null;
  };

  return {
    Harness,
    ref,
    setProps: (nextProps) => {
      props = {
        ...props,
        ...nextProps,
      };
    },
  };
}

describe("useEmbeddedFieldDraftController", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("publishes immediate drafts without resetting to a stale prop on local rerender", () => {
    const onPublish = vi.fn();
    const { Harness, ref } = createHarness({
      onPublish,
      publishPolicy: "immediate",
      value: "old",
    });

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.updateDraft("new");
    });

    expect(onPublish).toHaveBeenCalledWith("new");
    expect(ref.result.draft).toBe("new");
  });

  it("keeps immediate drafts pending when the caller needs local pinning", () => {
    const onPublish = vi.fn();
    const { Harness, ref } = createHarness({
      keepPendingAfterImmediatePublish: true,
      onPublish,
      publishPolicy: "immediate",
      value: "old",
    });

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.updateDraft("new");
    });

    expect(ref.result.pendingDraftRef.current).toBe("new");
    act(() => {
      ref.result.commitDraft();
    });
    expect(ref.result.pendingDraftRef.current).toBeNull();
  });

  it("defers on-commit drafts until commit and then syncs external values", () => {
    const onPublish = vi.fn();
    const { Harness, ref, setProps } = createHarness({
      onPublish,
      publishPolicy: "on-commit",
      value: "old",
    });

    act(() => root.render(createElement(Harness)));
    act(() => {
      ref.result.updateDraft("new");
    });

    expect(onPublish).not.toHaveBeenCalled();
    expect(ref.result.draft).toBe("new");

    act(() => {
      ref.result.commitDraft();
    });
    expect(onPublish).toHaveBeenCalledWith("new");

    setProps({ value: "external" });
    act(() => root.render(createElement(Harness)));
    expect(ref.result.draft).toBe("external");
  });
});
