/**
 * Breadcrumb bar for the editor.
 *
 * Displays the heading hierarchy at the cursor's current position as
 * a sticky bar at the top of the editor area. Clicking a breadcrumb
 * segment scrolls to that heading.
 *
 * Implemented as a CM6 panel via `showPanel`.
 */

import { type Extension } from "@codemirror/state";
import { EditorView, type Panel, showPanel, type ViewUpdate } from "@codemirror/view";
import {
  extractHeadings,
  headingAncestryAt,
  type HeadingEntry,
} from "./heading-ancestry";

/** Build the breadcrumb DOM for a given ancestry. */
function renderBreadcrumbs(
  dom: HTMLElement,
  ancestry: ReadonlyArray<HeadingEntry>,
  view: EditorView,
): void {
  dom.innerHTML = "";

  if (ancestry.length === 0) {
    dom.classList.add("breadcrumb-bar-empty");
    return;
  }

  dom.classList.remove("breadcrumb-bar-empty");

  for (let i = 0; i < ancestry.length; i++) {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "›";
      dom.appendChild(sep);
    }

    const segment = document.createElement("span");
    segment.className = "breadcrumb-segment";
    segment.textContent = ancestry[i].text;
    segment.title = ancestry[i].text;

    const pos = ancestry[i].pos;
    segment.addEventListener("click", () => {
      view.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
      });
      view.focus();
    });

    dom.appendChild(segment);
  }
}

/** Create the breadcrumb panel for the editor. */
function createBreadcrumbPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "breadcrumb-bar";

  const headings = extractHeadings(view.state);
  const cursorPos = view.state.selection.main.head;
  const ancestry = headingAncestryAt(headings, cursorPos);
  renderBreadcrumbs(dom, ancestry, view);

  return {
    dom,
    top: true,
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) {
        const headings = extractHeadings(update.state);
        const cursorPos = update.state.selection.main.head;
        const ancestry = headingAncestryAt(headings, cursorPos);
        renderBreadcrumbs(dom, ancestry, update.view);
      }
    },
  };
}

/** CM6 extension that adds a breadcrumb bar at the top of the editor. */
export const breadcrumbExtension: Extension = showPanel.of(createBreadcrumbPanel);
