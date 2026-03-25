/**
 * Regression test: fenced div blocks (theorem, proof, definition) render correctly.
 *
 * Verifies that FencedDiv nodes exist in the Lezer tree and that block header
 * widgets are present in the DOM.
 */

/* global window */

export const name = "fenced-divs";

export async function run(page) {
  await page.evaluate(() => window.__app.openFile("index.md"));
  await new Promise((r) => setTimeout(r, 800));

  // Check Lezer tree for FencedDiv nodes
  const treeDivs = await page.evaluate(() => window.__cmDebug.tree());

  if (!Array.isArray(treeDivs) || treeDivs.length === 0) {
    return { pass: false, message: "No FencedDiv nodes found in syntax tree" };
  }

  // Check DOM for rendered block header widgets
  const headerCount = await page.evaluate(() => {
    const editor = window.__cmView.dom;
    return editor.querySelectorAll(".cf-block-header").length;
  });

  if (headerCount === 0) {
    return {
      pass: false,
      message: `Found ${treeDivs.length} FencedDiv nodes but no .cf-block-header elements in DOM`,
    };
  }

  // Verify closing fences are hidden (zero height)
  const fences = await page.evaluate(() => window.__cmDebug.fences());
  const visibleCloseFences = Array.isArray(fences)
    ? fences.filter((f) => f.visible === true)
    : [];

  // In rich mode, closing fences should be hidden
  const mode = await page.evaluate(() => window.__app.getMode());
  if (mode === "rich" && visibleCloseFences.length > 0) {
    return {
      pass: false,
      message: `${visibleCloseFences.length} closing fences are visible in rich mode (should be hidden)`,
    };
  }

  return { pass: true };
}
