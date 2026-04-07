import { describe, expect, it } from "vitest";
import { renderInline } from "./inline";

describe("renderInline module", () => {
  it("degrades links to inert text for ui-chrome-inline", () => {
    expect(renderInline("[text](http://example.com)", undefined, "ui-chrome-inline")).toBe(
      "text",
    );
  });

  it("degrades images to alt text for document-inline", () => {
    expect(renderInline("![alt](image.png)", undefined, "document-inline")).toBe("alt");
  });
});
