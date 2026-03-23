import type { Settings, ExportFormat } from "../../lib/types";
import { Row } from "./shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface ExportTabProps {
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function ExportTab({ settings, onUpdateSetting }: ExportTabProps) {
  return (
    <section>
      <Row label="Default format">
        <Select
          value={settings.defaultExportFormat}
          onValueChange={(value) => {
            onUpdateSetting("defaultExportFormat", value as ExportFormat);
          }}
        >
          <SelectTrigger className="w-32" aria-label="Default export format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="latex">LaTeX</SelectItem>
            <SelectItem value="html">HTML</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </section>
  );
}
