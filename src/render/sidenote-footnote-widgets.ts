import { type EditorView, WidgetType } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import {
  footnoteInlineToggleEffect,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
} from "./sidenote-state";
import {
  SimpleTextRenderWidget,
  serializeMacros,
} from "./source-widget";
import { cloneRenderedHTMLElement } from "./widget-core";

/** Widget for the [^id]: label, rendered as a small superscript number. */
export class FootnoteDefLabelWidget extends SimpleTextRenderWidget {
  constructor(
    private readonly number: number,
    private readonly id: string,
  ) {
    super({
      tagName: "sup",
      className: "cf-sidenote-def-label",
      text: String(number),
    });
  }

  eq(other: FootnoteDefLabelWidget): boolean {
    return this.number === other.number && this.id === other.id;
  }
}

/** Widget for a footnote reference rendered as a superscript number. */
export class FootnoteRefWidget extends SimpleTextRenderWidget {
  private readonly mouseDownHandlers = new WeakMap<HTMLElement, (event: MouseEvent) => void>();

  constructor(
    private readonly number: number,
    private readonly id: string,
    private readonly defFrom: number,
    private readonly inlineExpanded: boolean,
  ) {
    super({
      tagName: "sup",
      className: CSS.sidenoteRef,
      text: String(number),
      attrs: { "data-footnote-id": id, "aria-label": `Footnote ${id}` },
    });
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.setSourceRangeAttrs(el);

    if (this.inlineExpanded) {
      el.classList.add(CSS.sidenoteRefExpanded);
    }

    if (view && this.defFrom >= 0) {
      const id = this.id;
      const defFrom = this.defFrom;
      const inlineExpanded = this.inlineExpanded;
      const handleMouseDown = (e: MouseEvent): void => {
        e.preventDefault();
        const collapsed = view.state.field(sidenotesCollapsedField, false) ?? false;
        if (collapsed) {
          view.dispatch({
            effects: footnoteInlineToggleEffect.of({ id, expanded: !inlineExpanded }),
          });
        } else {
          view.focus();
          view.dispatch({ selection: { anchor: defFrom }, scrollIntoView: true });
        }
      };
      this.mouseDownHandlers.set(el, handleMouseDown);
      el.addEventListener("mousedown", handleMouseDown);
    } else if (view && this.sourceFrom >= 0) {
      this.bindSourceReveal(el, view);
    }

    return el;
  }

  override destroy(dom: HTMLElement): void {
    const handleMouseDown = this.mouseDownHandlers.get(dom);
    if (!handleMouseDown) return;
    dom.removeEventListener("mousedown", handleMouseDown);
    this.mouseDownHandlers.delete(dom);
  }

  eq(other: FootnoteRefWidget): boolean {
    return (
      this.number === other.number &&
      this.id === other.id &&
      this.defFrom === other.defFrom &&
      this.inlineExpanded === other.inlineExpanded
    );
  }
}

/**
 * Widget that renders an inline footnote expansion below the ref line (#458).
 *
 * Uses a plain WidgetType because it is placed via Decoration.widget with
 * block: true, not Decoration.replace.
 */
export class FootnoteInlineWidget extends WidgetType {
  private readonly macrosKey: string;
  private cachedDOM: HTMLElement | null = null;
  private readonly mouseDownHandlers = new WeakMap<HTMLElement, (event: MouseEvent) => void>();

  constructor(
    private readonly number: number,
    private readonly id: string,
    private readonly content: string,
    private readonly macros: Record<string, string>,
    private readonly defFrom: number,
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  private createCachedDOM(): HTMLElement {
    if (this.cachedDOM) {
      return cloneRenderedHTMLElement(this.cachedDOM);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "cf-footnote-inline";
    wrapper.setAttribute("aria-label", `Footnote ${this.id} content`);

    const header = document.createElement("div");
    header.className = "cf-footnote-inline-header";

    const num = document.createElement("sup");
    num.className = "cf-footnote-inline-number";
    num.textContent = String(this.number);
    header.appendChild(num);

    const editBtn = document.createElement("button");
    editBtn.className = "cf-footnote-inline-edit";
    editBtn.textContent = "Edit";
    editBtn.title = "Navigate to footnote definition";
    header.appendChild(editBtn);
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.className = "cf-footnote-inline-body";
    renderDocumentFragmentToDom(body, {
      kind: "footnote",
      text: this.content,
      macros: this.macros,
    });
    wrapper.appendChild(body);

    this.cachedDOM = cloneRenderedHTMLElement(wrapper);
    return wrapper;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = this.createCachedDOM();
    const defFrom = this.defFrom;
    const id = this.id;
    const handleMouseDown = (e: MouseEvent): void => {
      const target = e.target;
      const origin = target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
      const editBtn = origin?.closest<HTMLButtonElement>(".cf-footnote-inline-edit");
      if (!editBtn || !wrapper.contains(editBtn)) return;

      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        effects: [
          sidenotesCollapsedEffect.of(false),
          footnoteInlineToggleEffect.of({ id, expanded: false }),
        ],
        selection: { anchor: defFrom },
        scrollIntoView: true,
      });
      view.focus();
    };
    this.mouseDownHandlers.set(wrapper, handleMouseDown);
    wrapper.addEventListener("mousedown", handleMouseDown);
    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    const handleMouseDown = this.mouseDownHandlers.get(dom);
    if (!handleMouseDown) return;
    dom.removeEventListener("mousedown", handleMouseDown);
    this.mouseDownHandlers.delete(dom);
  }

  eq(other: FootnoteInlineWidget): boolean {
    return (
      this.number === other.number &&
      this.id === other.id &&
      this.content === other.content &&
      this.defFrom === other.defFrom &&
      this.macrosKey === other.macrosKey
    );
  }

  ignoreEvent(): boolean {
    return true;
  }
}
