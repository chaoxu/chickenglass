import { type EditorState, type Range } from "@codemirror/state";
import { type Decoration, type EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { IFRAME_MAX_ATTEMPTS, IFRAME_POLL_INTERVAL_MS } from "../constants/timing";
import type { FencedDivInfo } from "../fenced-block/model";
import {
  pushWidgetDecoration,
  ShellWidget,
} from "../render/render-core";
import { mutateWithScrollStabilizedMeasure } from "../render/scroll-anchor";
import {
  extractYoutubeId,
  gistEmbedUrl,
  isValidEmbedUrl,
  youtubeEmbedUrl,
} from "./embed-plugin";

/**
 * Compute the iframe src URL for an embed block.
 *
 * Returns undefined if the URL is invalid or cannot be embedded.
 */
function computeEmbedSrc(
  embedType: string,
  rawUrl: string,
): string | undefined {
  const url = rawUrl.trim();
  if (!isValidEmbedUrl(url)) return undefined;

  switch (embedType) {
    case "youtube": {
      const videoId = extractYoutubeId(url);
      return videoId ? youtubeEmbedUrl(videoId) : undefined;
    }
    case "gist":
      return gistEmbedUrl(url);
    case "embed":
    case "iframe":
    default:
      return url;
  }
}

/**
 * Try to read the iframe's content height and apply it.
 *
 * Returns `"resized"` on success, `"unavailable"` if the body isn't ready,
 * or `"blocked"` if cross-origin restrictions prevent access.
 */
function tryResizeIframe(
  iframe: HTMLIFrameElement,
  view?: EditorView,
): "resized" | "unavailable" | "blocked" {
  try {
    const doc = iframe.contentDocument;
    if (doc?.body) {
      const height = doc.body.scrollHeight;
      if (height > 0) {
        const nextHeight = `${height}px`;
        if (iframe.style.height !== nextHeight) {
          mutateWithScrollStabilizedMeasure(view, () => {
            iframe.style.height = nextHeight;
          });
        }
        return "resized";
      }
    }
    return "unavailable";
  } catch (_error) {
    // best-effort: cross-origin iframe blocks contentDocument access
    return "blocked";
  }
}

/**
 * Auto-resize a gist iframe to match its content height.
 *
 * Attempts to read `contentDocument.body.scrollHeight` (works when
 * same-origin or sandbox allows access). If cross-origin blocks access,
 * stops immediately. Otherwise polls until content is ready.
 */
function autoResizeGistIframe(
  iframe: HTMLIFrameElement,
  view?: EditorView,
): () => void {
  const result = tryResizeIframe(iframe, view);
  if (result !== "unavailable") {
    return () => {};
  }

  // Content not ready yet — poll until it loads or we give up
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const poll = (): void => {
    if (cancelled) return;
    attempts++;
    const result = tryResizeIframe(iframe, view);
    if (result === "unavailable" && attempts < IFRAME_MAX_ATTEMPTS) {
      timer = setTimeout(poll, IFRAME_POLL_INTERVAL_MS);
    } else {
      timer = null;
    }
  };

  timer = setTimeout(poll, IFRAME_POLL_INTERVAL_MS);
  return () => {
    cancelled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function embedSandboxPermissions(embedType: string): string {
  if (embedType === "youtube") {
    return "allow-scripts allow-presentation";
  }
  return "allow-scripts";
}

/** Widget that renders an iframe for embed blocks. */
class EmbedWidget extends ShellWidget {
  private readonly gistCleanup = new WeakMap<
    HTMLElement,
    {
      readonly iframe: HTMLIFrameElement;
      readonly handleLoad: () => void;
      readonly cancelResize: () => void;
    }
  >();

  constructor(
    private readonly src: string,
    private readonly embedType: string,
    private readonly active: boolean = false,
  ) {
    super();
    this.useLiveSourceRange = false;
  }

  private attachGistResize(
    wrapper: HTMLElement,
    iframe: HTMLIFrameElement,
    view?: EditorView,
  ): void {
    let cancelResize = () => {};
    const handleLoad = (): void => {
      cancelResize();
      cancelResize = autoResizeGistIframe(iframe, view);
    };
    iframe.addEventListener("load", handleLoad, { once: true });
    this.gistCleanup.set(wrapper, {
      iframe,
      handleLoad,
      cancelResize: () => {
        cancelResize();
      },
    });
  }

  createDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = this.active
      ? `${CSS.embed(this.embedType)} ${CSS.activeShellWidget}`
      : CSS.embed(this.embedType);

    const iframe = document.createElement("iframe");
    iframe.src = this.src;
    iframe.setAttribute("sandbox", embedSandboxPermissions(this.embedType));
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("frameborder", "0");

    if (this.embedType === "youtube") {
      iframe.setAttribute("allowfullscreen", "");
      iframe.className = CSS.embedYoutubeIframe;
    } else {
      iframe.className = CSS.embedIframe;
    }

    wrapper.appendChild(iframe);
    return wrapper;
  }

  override toDOM(view?: EditorView): HTMLElement {
    const wrapper = this.createDOM();
    this.setSourceRangeAttrs(wrapper);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(wrapper, view);
    }

    if (this.embedType === "gist") {
      const iframe = wrapper.querySelector("iframe");
      if (iframe instanceof HTMLIFrameElement) {
        this.attachGistResize(wrapper, iframe, view);
      }
    }

    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    const cleanup = this.gistCleanup.get(dom);
    if (!cleanup) return;
    cleanup.iframe.removeEventListener("load", cleanup.handleLoad);
    cleanup.cancelResize();
    this.gistCleanup.delete(dom);
  }

  protected override bindSourceReveal(
    _el: HTMLElement,
    _view: EditorView,
  ): void {
    // Embed previews remain interactive in stable-shell mode.
    // Structure editing is entered explicitly from the block header, not by
    // clicking the iframe surface and teleporting a hidden caret.
  }

  eq(other: EmbedWidget): boolean {
    return (
      this.src === other.src &&
      this.embedType === other.embedType &&
      this.active === other.active
    );
  }
}

/** Replace embed block body content with an iframe widget. */
export function addEmbedWidget(
  state: EditorState,
  div: FencedDivInfo,
  openLine: { readonly to: number },
  items: Range<Decoration>[],
  active: boolean,
): void {
  if (div.singleLine || div.closeFenceFrom < 0) return;

  const bodyFrom = openLine.to + 1; // start of first body line
  const bodyTo = div.closeFenceFrom - 1; // end of last body line (before newline)
  if (bodyFrom > bodyTo) return;

  const bodyText = state.sliceDoc(bodyFrom, bodyTo);
  const rawUrl = bodyText.trim();
  const src = computeEmbedSrc(div.className, rawUrl);
  if (src) {
    pushWidgetDecoration(items, new EmbedWidget(src, div.className, active), bodyFrom, bodyTo);
  }
}
