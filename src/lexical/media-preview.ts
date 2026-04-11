import { useEffect, useMemo, useState } from "react";

import { readImageFileAsDataUrl } from "../lib/image-data-url";
import { isPdfTarget } from "../lib/pdf-target";
import { projectPathCandidatesFromDocument } from "../lib/project-paths";
import { useLexicalRenderContext } from "./render-context";
import { rasterizePdfPage1 } from "./pdf-rasterizer";

function isLocalAssetTarget(target: string): boolean {
  return !/^(?:[a-z]+:|\/\/|\/)/i.test(target);
}

export interface AssetPreviewState {
  readonly fallbackUrl: string;
  readonly kind: "error" | "loading" | "ready";
  readonly previewUrl?: string;
}

export function useAssetPreview(target: string): AssetPreviewState {
  const { docPath, fs, resolveAssetUrl } = useLexicalRenderContext();
  const fallbackUrl = useMemo(
    () => resolveAssetUrl(target) ?? target,
    [resolveAssetUrl, target],
  );
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(() =>
    isPdfTarget(target) ? undefined : fallbackUrl,
  );
  const [kind, setKind] = useState<AssetPreviewState["kind"]>(() =>
    isPdfTarget(target) ? "loading" : "ready",
  );

  useEffect(() => {
    let cancelled = false;

    if (!isPdfTarget(target)) {
      setPreviewUrl(fallbackUrl);
      setKind("ready");
      return () => {
        cancelled = true;
      };
    }

    if (!isLocalAssetTarget(target) || !docPath) {
      setPreviewUrl(undefined);
      setKind("error");
      return () => {
        cancelled = true;
      };
    }

    setPreviewUrl(undefined);
    setKind("loading");

    void (async () => {
      for (const candidate of projectPathCandidatesFromDocument(docPath, target)) {
        try {
          const bytes = await fs.readFileBinary(candidate);
          const canvas = await rasterizePdfPage1(bytes);
          if (!canvas) {
            continue;
          }
          const dataUrl = canvas.toDataURL("image/png");
          if (!cancelled) {
            setPreviewUrl(dataUrl);
            setKind("ready");
          }
          return;
        } catch {
          // Try the next candidate.
        }
      }

      if (!cancelled) {
        setPreviewUrl(undefined);
        setKind("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docPath, fallbackUrl, fs, target]);

  return {
    fallbackUrl,
    kind,
    previewUrl,
  };
}

export function useLocalImageDataUrl(target: string): string | null {
  const { docPath, fs } = useLexicalRenderContext();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isLocalAssetTarget(target) || !docPath) {
      setDataUrl(null);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      for (const candidate of projectPathCandidatesFromDocument(docPath, target)) {
        try {
          const next = await readImageFileAsDataUrl(candidate, fs);
          if (!next) {
            continue;
          }
          if (!cancelled) {
            setDataUrl(next);
          }
          return;
        } catch {
          // Try the next candidate.
        }
      }

      if (!cancelled) {
        setDataUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docPath, fs, target]);

  return dataUrl;
}
