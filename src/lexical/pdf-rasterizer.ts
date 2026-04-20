export interface PdfRasterizeOptions {
  readonly maxHeight?: number;
  readonly maxWidth?: number;
}

const DEFAULT_MAX_WIDTH = 1200;

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjsLib(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then(async (mod) => {
      try {
        const workerUrl = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        mod.GlobalWorkerOptions.workerSrc = workerUrl.default;
      } catch {
        // Fall back to main-thread parsing when the worker asset is unavailable.
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

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
        scale = Math.min(scale, opts.maxHeight / rawViewport.height);
      }
      scale = Math.min(scale, 1);

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise;

      page.cleanup();
      return canvas;
    } finally {
      await pdf.destroy();
    }
  } catch {
    return null;
  }
}
