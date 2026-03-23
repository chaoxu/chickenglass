import { describe, it, expect } from "vitest";
import { escapeMarkdownPath } from "./image-paste";

describe("escapeMarkdownPath", () => {
  // Regression: paths containing `)` or spaces break CommonMark image syntax
  // because `)` terminates the URL in `![alt](url)` and spaces split the link.
  // See #346.

  it("leaves simple relative paths unchanged", () => {
    expect(escapeMarkdownPath("assets/image.png")).toBe("assets/image.png");
  });

  it("encodes spaces so the URL is not split", () => {
    expect(escapeMarkdownPath("my images/photo.png")).toBe("my%20images/photo.png");
  });

  it("encodes closing parenthesis to prevent link termination", () => {
    expect(escapeMarkdownPath("assets/foo(1).png")).toBe("assets/foo(1%29.png");
  });

  it("encodes both spaces and closing parentheses", () => {
    expect(escapeMarkdownPath("my files/foo (1).png")).toBe("my%20files/foo%20(1%29.png");
  });

  it("leaves data URLs intact except for encoded characters", () => {
    const dataUrl = "data:image/png;base64,abc123==";
    // No spaces or ) in this data URL — should pass through unchanged.
    expect(escapeMarkdownPath(dataUrl)).toBe(dataUrl);
  });

  it("handles an empty string", () => {
    expect(escapeMarkdownPath("")).toBe("");
  });

  it("does not encode other special characters", () => {
    // Characters like &, %, #, etc. are not encoded — only ) and space.
    expect(escapeMarkdownPath("assets/image-2024_01.png")).toBe(
      "assets/image-2024_01.png",
    );
  });
});
