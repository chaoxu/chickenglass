/**
 * PDF rasterizer service.
 *
 * Dynamically imports pdfjs-dist (~2 MB) so Vite can code-split it out of the
 * main bundle. Renders page 1 of a PDF to an HTMLCanvasElement suitable for
 * direct use as a CM6 widget DOM element.
 *
 * On failure (corrupt PDF, missing canvas support, etc.) returns null —
 * callers should degrade gracefully.
 */

/** Maximum pixel dimensions for the rendered canvas. */
export interface PdfRasterizeOptions {
  /** Maximum width in CSS pixels (default 1200). */
  maxWidth?: number;
  /** Maximum height in CSS pixels — if omitted, height is proportional. */
  maxHeight?: number;
}

const DEFAULT_MAX_WIDTH = 1200;

/** Lazily cached dynamic import of pdfjs-dist. */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjsLib(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then(async (mod) => {
      // Configure the web worker so PDF parsing runs off the main thread.
      // Use Vite's ?url import to get the correct resolved path.
      try {
        const workerUrl = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        mod.GlobalWorkerOptions.workerSrc = workerUrl.default;
      } catch (_error) {
        // Worker unavailable — pdfjs falls back to main-thread parsing
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

/**
 * Rasterize page 1 of a PDF document to an HTMLCanvasElement.
 *
 * Returns the canvas directly — no PNG encoding or data URL conversion.
 * The caller can use it as a DOM element in a CM6 widget.
 *
 * @param data  Raw PDF bytes.
 * @param opts  Optional size constraints.
 * @returns An HTMLCanvasElement with page 1 rendered, or null on failure.
 */
export async function rasterizePdfPage1(
  data: Uint8Array,
  opts?: PdfRasterizeOptions,
): Promise<HTMLCanvasElement | null> {
  try {
    const pdfjsLib = await getPdfjsLib();

    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;

    try {
      const page = await pdf.getPage(1);

      const maxWidth = opts?.maxWidth ?? DEFAULT_MAX_WIDTH;
      const rawViewport = page.getViewport({ scale: 1 });

      let scale = maxWidth / rawViewport.width;

      if (opts?.maxHeight) {
        const heightScale = opts.maxHeight / rawViewport.height;
        scale = Math.min(scale, heightScale);
      }

      // Never upscale beyond 1:1.
      scale = Math.min(scale, 1);

      const viewport = page.getViewport({ scale });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      page.cleanup();
      return canvas;
    } finally {
      await pdf.destroy();
    }
  } catch (_error) {
    return null;
  }
}
