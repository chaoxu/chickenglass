/**
 * PDF rasterizer service.
 *
 * Dynamically imports pdfjs-dist (~2 MB) so Vite can code-split it out of the
 * main bundle.  Renders page 1 of a PDF to a data:image/png URL suitable for
 * display in an <img> element.
 *
 * On failure (corrupt PDF, missing canvas support, etc.) returns an empty
 * string — callers should treat "" as "no preview available".
 */

/** Maximum pixel dimensions for the rendered image. */
export interface PdfRasterizeOptions {
  /** Maximum width in CSS pixels (default 1200). */
  maxWidth?: number;
  /** Maximum height in CSS pixels — if omitted, height is proportional. */
  maxHeight?: number;
}

const DEFAULT_MAX_WIDTH = 1200;

/** Returned on failure so callers always get a string. */
const EMPTY_DATA_URL = "";

/** Lazily cached dynamic import of pdfjs-dist. */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjsLib(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      // Configure the web worker so PDF parsing runs off the main thread.
      // Use string concatenation to prevent Vite's import analysis from
      // trying to resolve the worker file at transform time (breaks in tests).
      const workerPath = "pdfjs-dist/build/pdf.worker.min.mjs";
      try {
        mod.GlobalWorkerOptions.workerSrc = new URL(workerPath, import.meta.url).href;
      } catch {
        // Worker unavailable — pdfjs falls back to main-thread parsing
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

/** Return type of `canvasAdapter.create`. */
export interface CanvasHandle {
  /** The DOM canvas (null when using OffscreenCanvas). */
  canvas: HTMLCanvasElement | null;
  /** 2D rendering context. */
  ctx: CanvasRenderingContext2D;
  /** Serialize the canvas to a data:image/png URL. */
  toDataUrl: () => Promise<string>;
}

/**
 * Canvas adapter — abstracted so unit tests (jsdom) can supply a mock.
 * @internal Exported for test use only. Production code should not import this.
 */
export const canvasAdapter = {
  /**
   * Create a canvas and return its 2D context.
   * Uses OffscreenCanvas when available, otherwise a DOM canvas.
   */
  create(width: number, height: number): CanvasHandle {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get OffscreenCanvas 2d context");
      return {
        canvas: null, // pdfjs accepts null when canvasContext is provided
        ctx: ctx as unknown as CanvasRenderingContext2D,
        toDataUrl: async () => {
          const blob = await canvas.convertToBlob({ type: "image/png" });
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
        },
      };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas 2d context");
    return {
      canvas,
      ctx,
      toDataUrl: async () => canvas.toDataURL("image/png"),
    };
  },
};

/**
 * Rasterize page 1 of a PDF document to a `data:image/png` URL.
 *
 * @param data  Raw PDF bytes.
 * @param opts  Optional size constraints.
 * @returns A data URL string, or `""` on failure.
 */
export async function rasterizePdfPage1(
  data: Uint8Array,
  opts?: PdfRasterizeOptions,
): Promise<string> {
  try {
    const pdfjsLib = await getPdfjsLib();

    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;

    try {
      const page = await pdf.getPage(1);

      // Determine scale to fit within max dimensions.
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

      const { canvas, ctx, toDataUrl } = canvasAdapter.create(width, height);

      const renderTask = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
      });
      await renderTask.promise;

      const dataUrl = await toDataUrl();

      page.cleanup();
      return dataUrl;
    } finally {
      await pdf.destroy();
    }
  } catch {
    // Intentional: return empty string on any failure (corrupt PDF, missing
    // canvas, worker failure, etc.) so the caller can degrade gracefully.
    return EMPTY_DATA_URL;
  }
}
