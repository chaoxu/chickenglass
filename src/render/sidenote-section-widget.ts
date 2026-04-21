import { type EditorView } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import { sidenotesCollapsedEffect } from "./sidenote-state";
import { RenderWidget, serializeMacros } from "./source-widget";

export interface FootnoteSectionEntry {
  readonly num: number;
  readonly id: string;
  readonly content: string;
  readonly defFrom: number;
}

/** Widget that renders a "Footnotes" section at the bottom when sidenotes are collapsed. */
export class FootnoteSectionWidget extends RenderWidget {
  private readonly macrosKey: string;

  constructor(
    private readonly entries: ReadonlyArray<FootnoteSectionEntry>,
    private readonly macros: Record<string, string>,
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const section = document.createElement("div");
      section.className = `${CSS.bibliography} ${CSS.bibliographyFootnotes}`;

      const heading = document.createElement("h2");
      heading.className = CSS.bibliographyHeading;
      heading.textContent = "Footnotes";
      section.appendChild(heading);

      const list = document.createElement("div");
      list.className = CSS.bibliographyList;

      for (const entry of this.entries) {
        const div = document.createElement("div");
        div.className = CSS.bibliographyEntry;
        div.dataset.defFrom = String(entry.defFrom);

        const num = document.createElement("sup");
        num.className = CSS.bibliographyEntryNumber;
        num.textContent = String(entry.num);
        div.appendChild(num);

        const content = document.createElement("span");
        renderDocumentFragmentToDom(content, {
          kind: "footnote",
          text: entry.content,
          macros: this.macros,
        });
        div.appendChild(content);

        list.appendChild(div);
      }

      section.appendChild(list);
      return section;
    });
  }

  toDOM(view: EditorView): HTMLElement {
    const section = this.createDOM();
    for (const div of section.querySelectorAll<HTMLElement>(`.${CSS.bibliographyEntry}`)) {
      const defFrom = Number(div.dataset.defFrom ?? "-1");
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.focus();
        view.dispatch({
          effects: sidenotesCollapsedEffect.of(false),
          selection: { anchor: defFrom },
          scrollIntoView: true,
        });
      });
    }
    return section;
  }

  eq(other: FootnoteSectionWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    return this.entries.every(
      (e, i) =>
        e.id === other.entries[i].id &&
        e.content === other.entries[i].content &&
        e.num === other.entries[i].num &&
        e.defFrom === other.entries[i].defFrom,
    ) && this.macrosKey === other.macrosKey;
  }
}
