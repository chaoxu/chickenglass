/**
 * About dialog for Chickenglass.
 *
 * Shows version, description, credits (Tauri, CodeMirror, KaTeX, Lezer, Pandoc),
 * and a link to the GitHub repository.
 *
 * Works in both Tauri and browser modes — implemented as a DOM overlay,
 * since Tauri's native dialog API doesn't support rich HTML content.
 */

const GITHUB_URL = "https://github.com/chickenglass/chickenglass";

/** Show the About dialog, creating it if needed, and return a cleanup function. */
export function showAboutDialog(): void {
  // Prevent duplicate dialogs
  if (document.getElementById("cg-about-dialog")) return;

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeyDown);

  // Wire the close button to the full close() so the keydown listener is removed
  const closeBtn = overlay.querySelector<HTMLButtonElement>(".cg-about-close");
  closeBtn?.addEventListener("click", close);

  // Focus the dialog so keyboard events are captured immediately
  const dialog = overlay.querySelector<HTMLElement>(".cg-about-panel");
  dialog?.focus();
}

// ---------------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------------

function buildOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.id = "cg-about-dialog";
  overlay.className = "cg-about-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "About Chickenglass");

  const panel = document.createElement("div");
  panel.className = "cg-about-panel";
  panel.tabIndex = -1;

  panel.appendChild(buildHeader());
  panel.appendChild(buildDescription());
  panel.appendChild(buildCredits());
  panel.appendChild(buildFooter());

  const closeBtn = buildCloseButton();
  panel.appendChild(closeBtn);

  overlay.appendChild(panel);
  injectStyles();
  return overlay;
}

function buildHeader(): HTMLElement {
  const header = document.createElement("div");
  header.className = "cg-about-header";

  const title = document.createElement("h2");
  title.className = "cg-about-title";
  title.textContent = "Chickenglass";

  const version = document.createElement("span");
  version.className = "cg-about-version";
  version.textContent = "v0.1.0";

  header.appendChild(title);
  header.appendChild(version);
  return header;
}

function buildDescription(): HTMLElement {
  const p = document.createElement("p");
  p.className = "cg-about-description";
  p.textContent = "Semantic document editor for mathematical writing.";
  return p;
}

interface Credit {
  name: string;
  url: string;
}

const CREDITS: Credit[] = [
  { name: "Tauri", url: "https://tauri.app" },
  { name: "CodeMirror", url: "https://codemirror.net" },
  { name: "KaTeX", url: "https://katex.org" },
  { name: "Lezer", url: "https://lezer.codemirror.net" },
  { name: "Pandoc", url: "https://pandoc.org" },
];

function buildCredits(): HTMLElement {
  const section = document.createElement("div");
  section.className = "cg-about-credits";

  const label = document.createElement("p");
  label.className = "cg-about-credits-label";
  label.textContent = "Built with:";
  section.appendChild(label);

  const list = document.createElement("ul");
  list.className = "cg-about-credits-list";

  for (const credit of CREDITS) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = credit.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = credit.name;
    item.appendChild(link);
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function buildFooter(): HTMLElement {
  const footer = document.createElement("div");
  footer.className = "cg-about-footer";

  const githubLink = document.createElement("a");
  githubLink.href = GITHUB_URL;
  githubLink.target = "_blank";
  githubLink.rel = "noopener noreferrer";
  githubLink.className = "cg-about-github-link";
  githubLink.textContent = "View on GitHub";

  footer.appendChild(githubLink);
  return footer;
}

function buildCloseButton(): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "cg-about-close";
  btn.setAttribute("aria-label", "Close");
  btn.textContent = "\u00D7"; // ×
  return btn;
}

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------

const STYLE_ID = "cg-about-styles";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.cg-about-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.cg-about-panel {
  position: relative;
  background: var(--cg-bg, #fff);
  color: var(--cg-fg, #1a1a1a);
  border-radius: 8px;
  padding: 2rem 2.5rem;
  min-width: 320px;
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  outline: none;
}

.cg-about-header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.cg-about-title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
}

.cg-about-version {
  font-size: 0.875rem;
  color: var(--cg-muted, #888);
}

.cg-about-description {
  margin: 0 0 1.25rem;
  color: var(--cg-muted, #555);
  font-size: 0.95rem;
}

.cg-about-credits {
  margin-bottom: 1.25rem;
}

.cg-about-credits-label {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--cg-muted, #888);
}

.cg-about-credits-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
}

.cg-about-credits-list a {
  color: var(--cg-link, #0066cc);
  text-decoration: none;
  font-size: 0.9rem;
}

.cg-about-credits-list a:hover {
  text-decoration: underline;
}

.cg-about-footer {
  border-top: 1px solid var(--cg-border, #e0e0e0);
  padding-top: 1rem;
  margin-top: 0.5rem;
}

.cg-about-github-link {
  color: var(--cg-link, #0066cc);
  text-decoration: none;
  font-size: 0.9rem;
}

.cg-about-github-link:hover {
  text-decoration: underline;
}

.cg-about-close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.25rem;
  color: var(--cg-muted, #888);
  line-height: 1;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.cg-about-close:hover {
  background: var(--cg-hover, rgba(0, 0, 0, 0.06));
  color: var(--cg-fg, #1a1a1a);
}
  `.trim();

  document.head.appendChild(style);
}
