import { type WidgetType } from "@codemirror/view";
import { makeTextElement } from "./widget-core";
import { RenderWidget } from "./source-widget";

export const REFERENCE_WIDGET_SELECTOR = "[data-reference-widget]";

export interface ReferenceRootSpec {
  readonly ariaLabel?: string;
  readonly className: string;
  readonly tagName?: string;
}

export interface ReferenceItemSpec {
  readonly className?: string;
  readonly id: string;
  readonly text: string;
}

export interface ReferenceListSpec extends ReferenceRootSpec {
  readonly items: readonly ReferenceItemSpec[];
  readonly prefixText?: string;
  readonly separatorText?: string;
  readonly suffixText?: string;
}

export interface SimpleTextReferenceSpec extends ReferenceRootSpec {
  readonly text: string;
}

function serializeReferenceRootSpec(spec: ReferenceRootSpec): string {
  return [
    spec.tagName ?? "span",
    spec.className,
    spec.ariaLabel ?? "",
  ].join("\0");
}

export function findReferenceWidgetContainer(
  target: Element | null,
): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest(REFERENCE_WIDGET_SELECTOR) as HTMLElement | null;
}

export function isReferenceWidgetTarget(target: EventTarget | null): boolean {
  return target instanceof Element && findReferenceWidgetContainer(target) !== null;
}

export abstract class ReferenceWidget extends RenderWidget {
  private readonly rootKey: string;

  protected constructor(
    protected readonly rootSpec: ReferenceRootSpec,
  ) {
    super();
    this.rootKey = serializeReferenceRootSpec(rootSpec);
  }

  protected createReferenceRoot(
    spec: ReferenceRootSpec = this.rootSpec,
  ): HTMLElement {
    const el = document.createElement(spec.tagName ?? "span");
    el.className = spec.className;
    el.dataset.referenceWidget = "true";
    if (spec.ariaLabel !== undefined) {
      el.setAttribute("aria-label", spec.ariaLabel);
    }
    return el;
  }

  protected createSimpleReferenceDOM(
    text: string,
    spec: ReferenceRootSpec = this.rootSpec,
  ): HTMLElement {
    const el = makeTextElement(
      spec.tagName ?? "span",
      spec.className,
      text,
    );
    el.dataset.referenceWidget = "true";
    if (spec.ariaLabel !== undefined) {
      el.setAttribute("aria-label", spec.ariaLabel);
    }
    return el;
  }

  protected appendReferenceItem(
    container: HTMLElement,
    item: ReferenceItemSpec,
  ): HTMLElement {
    const span = document.createElement("span");
    span.setAttribute("data-ref-id", item.id);
    if (item.className) {
      span.className = item.className;
    }
    span.textContent = item.text;
    container.appendChild(span);
    return span;
  }

  protected createReferenceListDOM(spec: ReferenceListSpec): HTMLElement {
    const container = this.createReferenceRoot(spec);
    if (spec.prefixText) {
      container.appendChild(document.createTextNode(spec.prefixText));
    }

    for (let i = 0; i < spec.items.length; i++) {
      if (i > 0 && spec.separatorText) {
        container.appendChild(document.createTextNode(spec.separatorText));
      }
      this.appendReferenceItem(container, spec.items[i]);
    }

    if (spec.suffixText) {
      container.appendChild(document.createTextNode(spec.suffixText));
    }
    return container;
  }

  protected hasSameReferenceRoot(other: ReferenceWidget): boolean {
    return this.rootKey === other.rootKey;
  }
}

export class SimpleTextReferenceWidget extends ReferenceWidget {
  constructor(
    protected readonly spec: SimpleTextReferenceSpec,
  ) {
    super(spec);
  }

  createDOM(): HTMLElement {
    return this.createSimpleReferenceDOM(this.spec.text, this.spec);
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof SimpleTextReferenceWidget &&
      this.spec.text === other.spec.text &&
      this.hasSameReferenceRoot(other)
    );
  }
}
