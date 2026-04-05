import { describe, expect, it } from "vitest";

import { CSS } from "./constants";
import {
  createPreviewSurfaceBody,
  createPreviewSurfaceContent,
  createPreviewSurfaceHeader,
  createPreviewSurfaceShell,
} from "./preview-surface";

describe("preview surface helpers", () => {
  it("creates shell and content elements with shared base classes", () => {
    const shell = createPreviewSurfaceShell(CSS.hoverPreviewTooltip);
    const content = createPreviewSurfaceContent(CSS.hoverPreview);

    expect(shell.className).toContain(CSS.previewSurfaceShell);
    expect(shell.className).toContain(CSS.hoverPreviewTooltip);
    expect(content.className).toContain(CSS.previewSurfaceContent);
    expect(content.className).toContain(CSS.hoverPreview);
  });

  it("creates header and body elements with shared preview content classes", () => {
    const header = createPreviewSurfaceHeader(CSS.hoverPreviewHeader);
    const body = createPreviewSurfaceBody(CSS.hoverPreviewBody);

    expect(header.className).toContain(CSS.previewSurfaceHeader);
    expect(header.className).toContain(CSS.hoverPreviewHeader);
    expect(body.className).toContain(CSS.previewSurfaceBody);
    expect(body.className).toContain(CSS.hoverPreviewBody);
  });
});
