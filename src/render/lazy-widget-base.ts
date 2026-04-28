import type { EditorView } from "@codemirror/view";
import {
  clearBlockWidgetHeightBinding,
  estimatedBlockWidgetHeight,
  observeBlockWidgetHeight,
  type BlockWidgetHeightBinding,
} from "./block-widget-height";
import { ShellWidget } from "./shell-widget";
import { serializeMacros } from "./source-widget";

export interface LazyWidgetHeightSpec {
  readonly cache: Map<string, number>;
  readonly key: string;
  readonly fallbackHeight: number;
}

export abstract class LazyWidgetBase extends ShellWidget {
  private readonly lazyHeightBinding: BlockWidgetHeightBinding = {
    resizeObserver: null,
    resizeMeasureFrame: null,
    reconnectObserver: null,
    detachedMeasureWarned: false,
  };

  protected abstract get usesLazyBlockShell(): boolean;

  override updateSourceRange(from: number, to: number): void {
    super.updateSourceRange(from, to);
    if (!this.usesLazyBlockShell) {
      this.shellSurfaceFrom = -1;
      this.shellSurfaceTo = -1;
    }
  }

  protected syncLazyWidgetAttrs(
    el: HTMLElement,
    view: EditorView | undefined,
    activeFenceGuides: boolean,
  ): void {
    this.syncWidgetAttrs(el, view);
    this.syncFenceGuideOptIn(el, activeFenceGuides, view);
  }

  protected observeLazyWidgetHeight(
    el: HTMLElement,
    view: EditorView,
    spec: LazyWidgetHeightSpec,
  ): void {
    observeBlockWidgetHeight(
      this.lazyHeightBinding,
      el,
      view,
      spec.cache,
      spec.key,
    );
  }

  protected clearLazyWidgetHeight(): void {
    clearBlockWidgetHeightBinding(this.lazyHeightBinding);
  }

  protected estimatedLazyWidgetHeight(spec: LazyWidgetHeightSpec): number {
    const cached = estimatedBlockWidgetHeight(spec.cache, spec.key);
    return cached >= 0 ? cached : spec.fallbackHeight;
  }

  override destroy(_dom?: HTMLElement): void {
    this.clearLazyWidgetHeight();
  }
}

export abstract class LazyMacroAwareWidget extends LazyWidgetBase {
  protected readonly macrosKey: string;

  constructor(macros: Record<string, string>) {
    super();
    this.macrosKey = serializeMacros(macros);
  }
}
