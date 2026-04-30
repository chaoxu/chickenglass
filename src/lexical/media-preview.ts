import { useEffect, useMemo, useState } from "react";

import { readImageFileAsDataUrl } from "../lib/image-data-url";
import { classifyAssetTarget } from "../lib/markdown-image";
import { markdownReferencePathCandidatesFromDocument } from "../lib/markdown-reference-paths";
import { useLexicalRenderResources } from "./render-context";
import { rasterizePdfPage1 } from "./pdf-rasterizer";
import { subscribeLexicalMediaPreviewInvalidations } from "./media-preview-invalidation";

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
  for (const candidate of markdownReferencePathCandidatesFromDocument(docPath, target)) {
    try {
      const next = await readImageFileAsDataUrl(candidate, fs);
      if (next) {
        return next;
      }
    } catch (_error) {
      // Candidate paths are speculative; unreadable files fall through to the next location.
    }
  }
  return null;
}

function pathMatchesLocalTarget(
  docPath: string,
  target: string,
  changedPath: string,
): boolean {
  return markdownReferencePathCandidatesFromDocument(docPath, target).includes(changedPath);
}

function useLocalMediaInvalidationVersion(
  docPath: string | undefined,
  target: string,
  isLocal: boolean,
): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!docPath || !target || !isLocal) {
      return;
    }

    return subscribeLexicalMediaPreviewInvalidations((changedPath) => {
      if (pathMatchesLocalTarget(docPath, target, changedPath)) {
        setVersion((current) => current + 1);
      }
    });
  }, [docPath, isLocal, target]);

  return version;
}

export function useAssetPreview(target: string): AssetPreviewState {
  const { docPath, fs, resolveAssetUrl } = useLexicalRenderResources();
  const fallbackUrl = useMemo(
    () => resolveAssetUrl(target) ?? target,
    [resolveAssetUrl, target],
  );
  const targetInfo = useMemo(() => classifyAssetTarget(target), [target]);
  const invalidationVersion = useLocalMediaInvalidationVersion(
    docPath,
    target,
    targetInfo.isLocal,
  );
  const initiallyNeedsLocalProbe = targetInfo.isLocal;
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(() =>
    targetInfo.isPdf || initiallyNeedsLocalProbe ? undefined : fallbackUrl,
  );
  const [kind, setKind] = useState<AssetPreviewState["kind"]>(() =>
    targetInfo.isPdf || initiallyNeedsLocalProbe ? "loading" : "ready",
  );

  useEffect(() => {
    let cancelled = false;

    if (!targetInfo.isPdf) {
      if (!targetInfo.isLocal || !docPath) {
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

    if (!targetInfo.isLocal || !docPath) {
      setPreviewUrl(undefined);
      setKind("error");
      return () => {
        cancelled = true;
      };
    }

    setPreviewUrl(undefined);
    setKind("loading");

    void (async () => {
      for (const candidate of markdownReferencePathCandidatesFromDocument(docPath, target)) {
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
        } catch (_error) {
          // Candidate paths are speculative; unreadable or unrasterizable PDFs fall through.
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
  }, [docPath, fallbackUrl, fs, invalidationVersion, target, targetInfo]);

  return {
    fallbackUrl,
    kind,
    previewUrl,
  };
}

export function useLocalImageDataUrl(target: string): string | null {
  const { docPath, fs } = useLexicalRenderResources();
  const targetInfo = useMemo(() => classifyAssetTarget(target), [target]);
  const invalidationVersion = useLocalMediaInvalidationVersion(
    docPath,
    target,
    targetInfo.isLocal,
  );
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!targetInfo.isLocal || !docPath) {
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
  }, [docPath, fs, invalidationVersion, target, targetInfo.isLocal]);

  return dataUrl;
}
