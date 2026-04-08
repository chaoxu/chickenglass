import {
  RenderWidget,
  serializeMacros,
} from "./source-widget";

/**
 * Source-bound widget that also participates in stable-shell surface tracking.
 *
 * Shell widgets keep the same source metadata as ordinary RenderWidget
 * instances, but additionally stamp `data-shell-from`/`data-shell-to` so the
 * shell surface overlay can measure them explicitly.
 */
export abstract class ShellWidget extends RenderWidget {
  /** Document offset of the start of the shell surface range. */
  shellSurfaceFrom = -1;

  /** Document offset of the end of the shell surface range. */
  shellSurfaceTo = -1;

  protected override setSourceRangeAttrs(el: HTMLElement): void {
    super.setSourceRangeAttrs(el);
    if (this.shellSurfaceFrom >= 0) {
      el.dataset.shellFrom = String(this.shellSurfaceFrom);
    }
    if (this.shellSurfaceTo >= 0) {
      el.dataset.shellTo = String(this.shellSurfaceTo);
    }
  }

  override updateSourceRange(from: number, to: number): void {
    const previousFrom = this.sourceFrom;
    const previousTo = this.sourceTo;
    super.updateSourceRange(from, to);
    if (this.shellSurfaceFrom === previousFrom || this.shellSurfaceFrom < 0) {
      this.shellSurfaceFrom = from;
    }
    if (this.shellSurfaceTo === previousTo || this.shellSurfaceTo < 0) {
      this.shellSurfaceTo = to;
    }
  }
}

/**
 * Shell widget whose identity also depends on math macro state.
 */
export abstract class ShellMacroAwareWidget extends ShellWidget {
  protected readonly macrosKey: string;

  constructor(macros: Record<string, string>) {
    super();
    this.macrosKey = serializeMacros(macros);
  }
}
