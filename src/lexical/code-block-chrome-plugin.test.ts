import { describe, expect, it, vi } from "vitest";

import { collectCodeBlockOverlays } from "./code-block-chrome-plugin";

function mockRect(
  element: HTMLElement,
  rect: {
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
  },
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    height: rect.bottom - rect.top,
    width: rect.right - rect.left,
    x: rect.left,
    y: rect.top,
    toJSON() {
      return rect;
    },
  } as DOMRect);
}

function createCodeBlockDom() {
  document.body.innerHTML = `
    <div id="surface">
      <div id="root">
        <pre><code class="cf-lexical-code-block" data-language="ts">const x = 1;</code></pre>
      </div>
    </div>
  `;

  const surface = document.getElementById("surface");
  const root = document.getElementById("root");
  const code = document.querySelector(".cf-lexical-code-block");
  const container = code?.parentElement;
  if (
    !(surface instanceof HTMLElement)
    || !(root instanceof HTMLElement)
    || !(code instanceof HTMLElement)
    || !(container instanceof HTMLElement)
  ) {
    throw new Error("failed to create code block DOM");
  }

  return { code, container, root, surface };
}

describe("collectCodeBlockOverlays", () => {
  it("does not add root scroll offset into overlay coordinates", () => {
    const { code, root, surface } = createCodeBlockDom();
    root.scrollTop = 280;
    surface.scrollTop = 0;

    mockRect(surface, { bottom: 600, left: 0, right: 800, top: 0 });
    mockRect(code, { bottom: 240, left: 32, right: 632, top: 120 });

    const overlay = collectCodeBlockOverlays(root, surface, { left: 0, top: surface.scrollTop })[0];
    expect(overlay?.rect.top).toBe(120);
  });

  it("keeps surface scroll offset in overlay coordinates", () => {
    const { code, root, surface } = createCodeBlockDom();
    root.scrollTop = 0;
    surface.scrollTop = 280;

    mockRect(surface, { bottom: 600, left: 0, right: 800, top: 0 });
    mockRect(code, { bottom: 240, left: 32, right: 632, top: 120 });

    const overlay = collectCodeBlockOverlays(root, surface, { left: 0, top: surface.scrollTop })[0];
    expect(overlay?.rect.top).toBe(400);
  });
});
