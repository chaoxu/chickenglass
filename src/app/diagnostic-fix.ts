import type { FileSystem } from "../lib/types";
import type { DiagnosticEntry, DiagnosticFix } from "./diagnostic-types";

export interface DiagnosticFixContext {
  readonly fs: FileSystem;
  readonly openFile: (path: string) => Promise<void> | void;
}

/**
 * Append a minimal BibTeX `@misc` stub for `id` to existing bib content.
 * The user is expected to fill in title/author after the file opens.
 */
export function buildBibStubAppend(id: string, existing: string): string {
  const stub = `@misc{${id},\n  title = {TODO: title for ${id}},\n}\n`;
  if (existing.length === 0) return stub;
  return existing.endsWith("\n") ? `${existing}${stub}` : `${existing}\n${stub}`;
}

export async function applyDiagnosticFix(
  fix: DiagnosticFix,
  context: DiagnosticFixContext,
): Promise<void> {
  switch (fix.kind) {
    case "open-bibliography": {
      await context.openFile(fix.bibPath);
      return;
    }
    case "insert-bibliography-stub": {
      const exists = await context.fs.exists(fix.bibPath);
      if (exists) {
        const current = await context.fs.readFile(fix.bibPath);
        await context.fs.writeFile(fix.bibPath, buildBibStubAppend(fix.id, current));
      } else {
        await context.fs.createFile(fix.bibPath, buildBibStubAppend(fix.id, ""));
      }
      await context.openFile(fix.bibPath);
      return;
    }
  }
}

export function applyDiagnosticEntryFix(
  diagnostic: DiagnosticEntry,
  context: DiagnosticFixContext,
): Promise<void> {
  if (!diagnostic.fix) return Promise.resolve();
  return applyDiagnosticFix(diagnostic.fix, context);
}
