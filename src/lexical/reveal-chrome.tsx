import { useMemo } from "react";
import katex from "katex";

import { SurfaceFloatingPortal } from "../lexical-next";
import { buildKatexOptions } from "../lib/katex-options";
import { EditorChromeBody, EditorChromePanel } from "./editor-chrome";
import { stripInlineMathDelimiters } from "./inline-math-source";
import { useLexicalRenderContext } from "./render-context";
import { preventKatexMouseDown } from "./renderers/shared";
import type { RevealChromePreview } from "./reveal-chrome-types";

interface RevealChromeRenderProps {
  readonly anchor: HTMLElement;
  readonly onAnchorLost: () => void;
  readonly source: string;
}

export function renderRevealChromePreview(
  preview: RevealChromePreview,
  props: RevealChromeRenderProps,
) {
  switch (preview.kind) {
    case "inline-math-preview":
      return <InlineMathRevealPreview {...props} />;
  }
}

function InlineMathRevealPreview({
  anchor,
  onAnchorLost,
  source,
}: RevealChromeRenderProps) {
  const { config } = useLexicalRenderContext();
  const body = useMemo(() => stripInlineMathDelimiters(source.trim()), [source]);
  const html = useMemo(
    () => katex.renderToString(body, buildKatexOptions(false, config.math)),
    [body, config.math],
  );

  return (
    <SurfaceFloatingPortal
      anchor={anchor}
      className="cf-lexical-inline-reveal-preview-portal"
      offsetPx={4}
      onAnchorLost={onAnchorLost}
      placement="bottom-start"
      zIndex={62}
    >
      <EditorChromePanel className="cf-lexical-inline-reveal-preview-shell">
        <EditorChromeBody className="cf-lexical-inline-reveal-preview-surface">
          <span
            aria-hidden="true"
            className="cf-lexical-inline-math-preview"
            dangerouslySetInnerHTML={{ __html: html }}
            onMouseDown={preventKatexMouseDown}
          />
        </EditorChromeBody>
      </EditorChromePanel>
    </SurfaceFloatingPortal>
  );
}
