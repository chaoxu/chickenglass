import type { Settings } from "../../lib/types";
import { Row } from "./shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface GeneralTabProps {
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function GeneralTab({ settings, onUpdateSetting }: GeneralTabProps) {
  const intervalValue =
    settings.autoSaveInterval === 0
      ? "off"
      : String(Math.round(settings.autoSaveInterval / 1000));

  function handleIntervalChange(v: string) {
    onUpdateSetting("autoSaveInterval", v === "off" ? 0 : Number(v) * 1000);
  }

  return (
    <section>
      <Row label="Auto-save interval">
        <Select
          value={intervalValue}
          onValueChange={handleIntervalChange}
        >
          <SelectTrigger className="w-40" aria-label="Auto-save interval">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="30">30 seconds</SelectItem>
            <SelectItem value="60">1 minute</SelectItem>
            <SelectItem value="120">2 minutes</SelectItem>
            <SelectItem value="300">5 minutes</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </section>
  );
}
