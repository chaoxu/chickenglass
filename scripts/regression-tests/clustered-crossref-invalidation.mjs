/**
 * Regression test: clustered crossrefs survive renumbering invalidations.
 *
 * Verifies that block-counter changes keep multi-id crossrefs rendered as a
 * cluster instead of collapsing to the unresolved fallback, and that partially
 * resolved clusters degrade one item at a time.
 */

import { openFixtureDocument } from "../test-helpers.mjs";

export const name = "clustered-crossref-invalidation";

export async function run(page) {
  await openFixtureDocument(page, "cogirth/clustered-crossref-invalidation.md", { project: "full-project" });
  await page.evaluate(() => window.__app.setMode("rich"));
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const readClusterSnapshot = (raw) => {
      const widget = [...window.__cmView.dom.querySelectorAll(".cf-crossref")]
        .find((node) => node.getAttribute("aria-label") === raw);
      if (!widget) return null;

      const parts = [...widget.querySelectorAll("span[data-ref-id]")]
        .map((span) => ({
          id: span.getAttribute("data-ref-id"),
          text: span.textContent ?? "",
          unresolved: span.classList.contains("cf-crossref-unresolved"),
        }));

      return {
        text: widget.textContent ?? "",
        parts,
      };
    };

    const view = window.__cmView;
    const originalDoc = view.state.doc.toString();

    try {
      const before = readClusterSnapshot("[@thm-a; @def-b]");

      const titleStart = originalDoc.indexOf("title: AB");
      const numberingStart = originalDoc.indexOf("numbering: global");
      if (titleStart < 0 || numberingStart < 0) {
        return { before, afterRenumber: null, partial: null, error: "missing frontmatter fields" };
      }

      view.dispatch({
        changes: [
          {
            from: titleStart + "title: ".length,
            to: titleStart + "title: AB".length,
            insert: "A",
          },
          {
            from: numberingStart + "numbering: ".length,
            to: numberingStart + "numbering: global".length,
            insert: "grouped",
          },
        ],
        selection: { anchor: 0 },
      });
      const afterRenumber = readClusterSnapshot("[@thm-a; @def-b]");

      const renumberedDoc = view.state.doc.toString();
      const clusterStart = renumberedDoc.indexOf("[@thm-a; @def-b]");
      if (clusterStart < 0) {
        return { before, afterRenumber, partial: null, error: "missing clustered reference after renumbering" };
      }

      view.dispatch({
        changes: {
          from: clusterStart + "[@thm-a; @".length,
          to: clusterStart + "[@thm-a; @def-b".length,
          insert: "missing",
        },
        selection: { anchor: 0 },
      });
      const partial = readClusterSnapshot("[@thm-a; @missing]");

      return { before, afterRenumber, partial, error: null };
    } finally {
      const currentDoc = view.state.doc.toString();
      if (currentDoc !== originalDoc) {
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: originalDoc },
          selection: { anchor: 0 },
        });
      }
    }
  });

  if (result.error) {
    return { pass: false, message: result.error };
  }

  if (!result.before) {
    return { pass: false, message: "missing initial clustered crossref widget" };
  }

  if (result.before.text !== "Theorem 1; Definition 2") {
    return {
      pass: false,
      message: `expected initial cluster text "Theorem 1; Definition 2", got ${JSON.stringify(result.before.text)}`,
    };
  }

  if (!result.afterRenumber) {
    return { pass: false, message: "clustered crossref disappeared after renumbering" };
  }

  if (result.afterRenumber.text !== "Theorem 1; Definition 1") {
    return {
      pass: false,
      message: `expected renumbered cluster text "Theorem 1; Definition 1", got ${JSON.stringify(result.afterRenumber.text)}`,
    };
  }

  if (result.afterRenumber.parts.some((part) => part.unresolved)) {
    return {
      pass: false,
      message: `renumbered cluster unexpectedly contained unresolved items: ${JSON.stringify(result.afterRenumber.parts)}`,
    };
  }

  if (!result.partial) {
    return { pass: false, message: "partial cluster did not render as a clustered crossref" };
  }

  if (result.partial.text !== "Theorem 1; missing") {
    return {
      pass: false,
      message: `expected partial cluster text "Theorem 1; missing", got ${JSON.stringify(result.partial.text)}`,
    };
  }

  if (result.partial.parts.length !== 2 || result.partial.parts[1]?.unresolved !== true) {
    return {
      pass: false,
      message: `expected second partial-cluster item to be unresolved, got ${JSON.stringify(result.partial.parts)}`,
    };
  }

  return {
    pass: true,
    message: "clustered crossrefs stayed rendered through renumbering and degraded unresolved items in place",
  };
}
