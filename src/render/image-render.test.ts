import { describe, it, expect } from "vitest";
import { CSS } from "../constants/css-classes";
import { ImageWidget } from "./image-render";

describe("ImageWidget", () => {
  describe("createDOM", () => {
    it("produces a span wrapper with cf-image-wrapper class", () => {
      const widget = new ImageWidget("photo", "photo.png");
      const el = widget.createDOM();
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toBe(CSS.imageWrapper);
    });

    it("contains an img element with correct src and alt", () => {
      const widget = new ImageWidget("a cat", "images/cat.jpg");
      const el = widget.createDOM();
      const img = el.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.src).toContain("images/cat.jpg");
      expect(img!.alt).toBe("a cat");
      expect(img!.title).toBe("a cat");
    });

    it("sets cf-image class on the img element", () => {
      const widget = new ImageWidget("alt", "src.png");
      const el = widget.createDOM();
      const img = el.querySelector("img");
      expect(img!.className).toBe(CSS.image);
    });

    it("handles empty alt text", () => {
      const widget = new ImageWidget("", "img.png");
      const el = widget.createDOM();
      const img = el.querySelector("img");
      expect(img!.alt).toBe("");
      expect(img!.title).toBe("");
    });
  });

  describe("eq", () => {
    it("returns true for same alt and src", () => {
      const a = new ImageWidget("cat", "cat.png");
      const b = new ImageWidget("cat", "cat.png");
      expect(a.eq(b)).toBe(true);
    });

    it("returns false when alt differs", () => {
      const a = new ImageWidget("cat", "photo.png");
      const b = new ImageWidget("dog", "photo.png");
      expect(a.eq(b)).toBe(false);
    });

    it("returns false when src differs", () => {
      const a = new ImageWidget("cat", "cat.png");
      const b = new ImageWidget("cat", "dog.png");
      expect(a.eq(b)).toBe(false);
    });

    it("returns false when both alt and src differ", () => {
      const a = new ImageWidget("cat", "cat.png");
      const b = new ImageWidget("dog", "dog.png");
      expect(a.eq(b)).toBe(false);
    });
  });

  describe("error handler", () => {
    it("sets cf-image-error class on load failure", () => {
      const widget = new ImageWidget("broken", "missing.png");
      const el = widget.createDOM();
      const img = el.querySelector("img")!;

      img.dispatchEvent(new Event("error"));

      expect(el.className).toBe(CSS.imageError);
      expect(el.textContent).toBe("[Image: broken]");
    });

    it("replaces img element with fallback text on error", () => {
      const widget = new ImageWidget("fallback alt", "bad.png");
      const el = widget.createDOM();
      const img = el.querySelector("img")!;

      img.dispatchEvent(new Event("error"));

      expect(el.querySelector("img")).toBeNull();
    });
  });
});
