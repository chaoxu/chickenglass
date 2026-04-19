import { useEffect, useMemo, useState } from "react";

import { readImageFileAsDataUrl } from "../lib/image-data-url";
import { projectPathCandidatesFromDocument } from "../lib/project-paths";
import { useLexicalRenderResources } from "./render-context";
import { rasterizePdfPage1 } from "./pdf-rasterizer";

function isLocalAssetTarget(target: string): boolean {
  return !/^(?:[a-z]+:|\/\/|\/)/i.test(target);
}

function isPdfTarget(target: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(target);
}

export interface AssetPreviewState {
  readonly fallbackUrl: string;
  readonly kind: "error" | "loading" | "ready";
  readonly previewUrl?: string;
}

async function readLocalImageDataUrl(
  docPath: string,
  target: string,
  fs: { readFileBinary(path: string): Promise<Uint8Array> },
): Promise<string | null> {
  for (const candidate of projectPathCandidatesFromDocument(docPath, target)) {
    try {
      const next = await readImageFileAsDataUrl(candidate, fs);
      if (next) {
        return next;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function useAssetPreview(target: string): AssetPreviewState {
  const { docPath, fs, resolveAssetUrl } = useLexicalRenderResources();
  const fallbackUrl = useMemo(
    () => resolveAssetUrl(target) ?? target,
    [resolveAssetUrl, target],
  );
  const initiallyNeedsLocalProbe = isLocalAssetTarget(target);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(() =>
    isPdfTarget(target) || initiallyNeedsLocalProbe ? undefined : fallbackUrl,
  );
  const [kind, setKind] = useState<AssetPreviewState["kind"]>(() =>
    isPdfTarget(target) || initiallyNeedsLocalProbe ? "loading" : "ready",
  );

  useEffect(() => {
    let cancelled = false;

    if (!isPdfTarget(target)) {
      if (!isLocalAssetTarget(target) || !docPath) {
        setPreviewUrl(fallbackUrl);
        setKind("ready");
        return () => {
          cancelled = true;
        };
      }

      setPreviewUrl(undefined);
      setKind("loading");

      void (async () => {
        const dataUrl = await readLocalImageDataUrl(docPath, target, fs);
        if (cancelled) {
          return;
        }
        if (dataUrl) {
          setPreviewUrl(dataUrl);
          setKind("ready");
          return;
        }
        setPreviewUrl(undefined);
        setKind("error");
      })();
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
  const { docPath, fs } = useLexicalRenderResources();
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
      const next = await readLocalImageDataUrl(docPath, target, fs);
      if (cancelled) {
        return;
      }
      setDataUrl(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [docPath, fs, target]);

  return dataUrl;
}
