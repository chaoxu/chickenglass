import { useCallback, useEffect, useMemo, useState } from "react";
import type { NodeKey } from "lexical";

import { updateTableBodyCell, updateTableHeaderCell } from "../../state/table-edit";
import { EmbeddedFieldEditor } from "../embedded-field-editor";
import { parseMarkdownTable, serializeMarkdownTable } from "../markdown/table-markdown";
import { useRawBlockUpdater } from "./shared";
import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";

export function TableBlockRenderer({
  nodeKey,
  raw,
}: {
  readonly nodeKey: NodeKey;
  readonly raw: string;
}) {
  const externalParsed = useMemo(() => parseMarkdownTable(raw), [raw]);
  const updateRaw = useRawBlockUpdater(nodeKey);
  const [draft, setDraft] = useState(externalParsed);

  useEffect(() => {
    setDraft(externalParsed);
  }, [externalParsed]);

  const updateHeaderCell = useCallback((columnIndex: number, nextValue: string) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const next = updateTableHeaderCell(prev, columnIndex, nextValue);
      updateRaw(serializeMarkdownTable(next));
      return next;
    });
  }, [updateRaw]);

  const updateBodyCell = useCallback((rowIndex: number, columnIndex: number, nextValue: string) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const next = updateTableBodyCell(prev, rowIndex, columnIndex, nextValue);
      updateRaw(serializeMarkdownTable(next));
      return next;
    });
  }, [updateRaw]);

  if (!draft) {
    return <div className="cf-lexical-raw-fallback">{raw}</div>;
  }

  return (
    <div className={LEXICAL_NODE_CLASS.TABLE_BLOCK}>
      <table>
        <thead>
          <tr>
            {draft.headers.map((cell, columnIndex) => (
              <th key={`h-${columnIndex}`}>
                <EmbeddedFieldEditor
                  activation="focus"
                  className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--table-cell"
                  doc={cell}
                  family="table-cell"
                  namespace={`coflat-table-${nodeKey}-head-${columnIndex}`}
                  onTextChange={(nextValue) => updateHeaderCell(columnIndex, nextValue)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draft.rows.map((row, rowIndex) => (
            <tr key={`r-${rowIndex}`}>
              {row.map((cell, columnIndex) => (
                <td key={`c-${rowIndex}-${columnIndex}`}>
                  <EmbeddedFieldEditor
                    activation="focus"
                    className="cf-lexical-editor cf-lexical-nested-editor cf-lexical-nested-editor--table-cell"
                    doc={cell}
                    family="table-cell"
                    keyboardEntryPriority="primary"
                    namespace={`coflat-table-${nodeKey}-${rowIndex}-${columnIndex}`}
                    onTextChange={(nextValue) => updateBodyCell(rowIndex, columnIndex, nextValue)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
