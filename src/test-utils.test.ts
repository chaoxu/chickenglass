import { describe, expect, it } from "vitest";
import { createTestView, destroyAllTestViews } from "./test-utils";

describe("test view cleanup", () => {
  it("destroys tracked CodeMirror views and removes their DOM parents", () => {
    const initialChildCount = document.body.childElementCount;
    const view = createTestView("hello", { focus: false });

    expect(document.body.childElementCount).toBe(initialChildCount + 1);

    destroyAllTestViews();

    expect(document.body.childElementCount).toBe(initialChildCount);
    expect(() => view.destroy()).not.toThrow();
  });
});
