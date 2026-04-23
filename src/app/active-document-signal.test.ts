import { describe, expect, it, vi } from "vitest";
import {
  createActiveDocumentSignal,
  type ActiveDocumentSignalScheduler,
} from "./active-document-signal";

function createManualScheduler(): {
  readonly schedule: ActiveDocumentSignalScheduler;
  readonly flush: () => void;
  readonly cancelCount: () => number;
  readonly scheduledCount: () => number;
} {
  const pending: Array<() => void> = [];
  let cancelled = 0;
  return {
    schedule: (notify) => {
      let active = true;
      pending.push(() => {
        if (active) {
          active = false;
          notify();
        }
      });
      return () => {
        if (active) {
          active = false;
          cancelled += 1;
        }
      };
    },
    flush: () => {
      pending.shift()?.();
    },
    cancelCount: () => cancelled,
    scheduledCount: () => pending.length,
  };
}

describe("createActiveDocumentSignal", () => {
  it("updates snapshots immediately while coalescing listener notifications", () => {
    const scheduler = createManualScheduler();
    const signal = createActiveDocumentSignal({ scheduleNotify: scheduler.schedule });
    const listener = vi.fn();
    signal.subscribe(listener);

    signal.publish("first.md");
    signal.publish("second.md");

    expect(signal.getSnapshot()).toEqual({
      path: "second.md",
      revision: 2,
    });
    expect(listener).not.toHaveBeenCalled();
    expect(scheduler.scheduledCount()).toBe(1);

    scheduler.flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(signal.getSnapshot()).toEqual({
      path: "second.md",
      revision: 2,
    });
  });

  it("does not schedule work when there are no subscribers", () => {
    const scheduler = createManualScheduler();
    const signal = createActiveDocumentSignal({ scheduleNotify: scheduler.schedule });

    signal.publish("quiet.md");

    expect(signal.getSnapshot()).toEqual({
      path: "quiet.md",
      revision: 1,
    });
    expect(scheduler.scheduledCount()).toBe(0);
  });

  it("notifies again when a publish happens during notification", () => {
    const scheduler = createManualScheduler();
    const signal = createActiveDocumentSignal({ scheduleNotify: scheduler.schedule });
    const listener = vi.fn(() => {
      if (signal.getSnapshot().path === "first.md") {
        signal.publish("second.md");
      }
    });
    signal.subscribe(listener);

    signal.publish("first.md");
    scheduler.flush();
    scheduler.flush();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(signal.getSnapshot()).toEqual({
      path: "second.md",
      revision: 2,
    });
    expect(scheduler.cancelCount()).toBe(0);
  });

  it("cancels pending notification work after the last listener unsubscribes", () => {
    const scheduler = createManualScheduler();
    const signal = createActiveDocumentSignal({ scheduleNotify: scheduler.schedule });
    const listener = vi.fn();
    const unsubscribe = signal.subscribe(listener);

    signal.publish("draft.md");
    unsubscribe();
    scheduler.flush();

    expect(listener).not.toHaveBeenCalled();
    expect(scheduler.cancelCount()).toBe(1);
    expect(signal.getSnapshot()).toEqual({
      path: "draft.md",
      revision: 1,
    });
  });
});
