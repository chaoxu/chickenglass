#!/usr/bin/env node
/**
 * One-shot CORS file server for rankdecrease, so a remote browser tab on
 * :5188 can fetch the fixture and feed it into the debug bridge.
 *
 * Usage:
 *   node scripts/serve-rankdecrease.mjs
 *
 * Then paste the printed snippet into the devtools console of the :5188 tab.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5190;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = {
  "/rankdecrease/main.md": resolve(REPO_ROOT, "fixtures/rankdecrease/main.md"),
  "/rankdecrease/ref.bib": resolve(REPO_ROOT, "fixtures/rankdecrease/ref.bib"),
};

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const file = ROUTES[req.url ?? ""];
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
    return;
  }
  try {
    const body = await readFile(file, "utf8");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(err?.message ?? err));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  process.stderr.write(`rankdecrease fixture server listening on :${PORT}\n`);
  process.stderr.write("paste this into the devtools console of the :5188 tab:\n\n");
  const snippet = `(async () => {
  const base = \`\${location.protocol}//\${location.hostname}:${PORT}\`;
  const [bib, md] = await Promise.all([
    fetch(\`\${base}/rankdecrease/ref.bib\`).then(r => r.text()),
    fetch(\`\${base}/rankdecrease/main.md\`).then(r => r.text()),
  ]);
  await Promise.all([window.__app.ready, window.__editor.ready]);
  await window.__app.openFileWithContent("rankdecrease/ref.bib", bib);
  await window.__app.closeFile({ discard: true });
  await window.__app.openFileWithContent("rankdecrease/main.md", md);
  console.log("rankdecrease loaded");
})();`;
  process.stdout.write(`${snippet}\n`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
