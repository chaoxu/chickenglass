import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const menuEventMockState = vi.hoisted(() => {
  const state = {
    handler: null as null | ((event: { payload: string }) => void),
    unlisten: vi.fn(),
    listen: vi.fn(),
    reset() {
      state.handler = null;
      state.unlisten.mockReset();
      state.listen.mockClear();
      state.listen.mockImplementation(async (
        _event: string,
        handler: (event: { payload: string }) => void,
      ) => {
        state.handler = handler;
        return state.unlisten;
      });
    },
  };
  state.reset();
  return state;
});

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: menuEventMockState.listen,
}));

const { useMenuEvents } = await import("./use-menu-events");

interface HarnessProps {
  handlers: Record<string, () => void>;
}

const Harness: FC<HarnessProps> = ({ handlers }) => {
  useMenuEvents(handlers);
  return null;
};

describe("useMenuEvents", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    menuEventMockState.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("routes file_quit through the frontend handler", async () => {
    const onQuit = vi.fn();

    await act(async () => {
      root.render(createElement(Harness, { handlers: { file_quit: onQuit } }));
      await Promise.resolve();
    });

    menuEventMockState.handler?.({ payload: "file_quit" });

    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
