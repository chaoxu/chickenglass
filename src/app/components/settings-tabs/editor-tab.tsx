import type { Settings } from "../../lib/types";
import { Row } from "./shared";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Slider } from "../ui/slider";
import {
  EDITOR_MODE_LABELS,
  REVEAL_PRESENTATION_LABELS,
  markdownEditorModes,
  revealPresentations,
} from "../../editor-mode";

interface EditorTabProps {
  settings: Settings;
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function EditorTab({ settings, onUpdateSetting }: EditorTabProps) {
  return (
    <section>
      {/* Font size */}
      <Row label={`Font size: ${settings.fontSize}px`}>
        <Slider
          aria-label="Font size"
          min={10}
          max={28}
          step={1}
          value={[settings.fontSize]}
          onValueChange={([value]) => { onUpdateSetting("fontSize", value); }}
          className="w-32"
        />
      </Row>

      {/* Line height */}
      <Row label={`Line height: ${settings.lineHeight.toFixed(1)}`}>
        <Slider
          aria-label="Line height"
          min={1.2}
          max={2.0}
          step={0.1}
          value={[settings.lineHeight]}
          onValueChange={([value]) => { onUpdateSetting("lineHeight", value); }}
          className="w-32"
        />
      </Row>

      {/* Tab size */}
      <Row label="Tab size">
        <Select
          value={String(settings.tabSize)}
          onValueChange={(value) => { onUpdateSetting("tabSize", Number(value)); }}
        >
          <SelectTrigger className="w-32" aria-label="Tab size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2 spaces</SelectItem>
            <SelectItem value="4">4 spaces</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      {/* Show line numbers */}
      <Row label="Show line numbers" htmlFor="sd-line-numbers">
        <Checkbox
          id="sd-line-numbers"
          checked={settings.showLineNumbers}
          onCheckedChange={(checked) => { onUpdateSetting("showLineNumbers", checked === true); }}
        />
      </Row>

      {/* Word wrap */}
      <Row label="Word wrap" htmlFor="sd-word-wrap">
        <Checkbox
          id="sd-word-wrap"
          checked={settings.wordWrap}
          onCheckedChange={(checked) => { onUpdateSetting("wordWrap", checked === true); }}
        />
      </Row>

      {/* Reveal scope (editor mode) */}
      <Row label="Reveal scope">
        <Select
          value={settings.editorMode}
          onValueChange={(value) => {
            onUpdateSetting("editorMode", value as Settings["editorMode"]);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Reveal scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {markdownEditorModes.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {EDITOR_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      {/* Reveal presentation (inline swap vs floating portal) */}
      <Row label="Reveal presentation">
        <Select
          value={settings.revealPresentation}
          onValueChange={(value) => {
            onUpdateSetting("revealPresentation", value as Settings["revealPresentation"]);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Reveal presentation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {revealPresentations.map((presentation) => (
              <SelectItem key={presentation} value={presentation}>
                {REVEAL_PRESENTATION_LABELS[presentation]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </section>
  );
}
