import type { TextAlign } from "@shift/wasm/protocol";
import type { RunId } from "@shift/types";
import { useSignalState } from "@shift/editor/signals";
import { Button, Tooltip } from "@shift/ui";
import AlignCenterIcon from "@/assets/general/align-center.svg";
import AlignLeftIcon from "@/assets/general/align-left.svg";
import AlignRightIcon from "@/assets/general/align-right.svg";
import FontSizeIcon from "@/assets/general/font-size.svg";
import LineHeightIcon from "@/assets/general/line-height.svg";
import ShapingOffIcon from "@/assets/general/shaping-off.svg";
import ShapingOnIcon from "@/assets/general/shaping-on.svg";
import type { TextSettingsTarget } from "@/types/textSettings";
import { useEditor } from "@/workspace/WorkspaceContext";
import { IconButton } from "./IconButton";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarPicker } from "./SidebarPicker";
import { SidebarSection } from "./SidebarSection";
import { LanguagePanel, ScriptPanel, languageLabel, scriptName, UNSET } from "./TextShapingPanels";

/** The proof text the sidebar's text settings apply to, and the node that places it. */
export function useTextSettingsRun(): TextSettingsTarget | null {
  const editor = useEditor();
  const run = useSignalState(editor.text.currentRunCell);
  const node = useSignalState(editor.text.currentRunNodeCell);
  if (!run || !node) return null;

  return { run, node };
}

/**
 * Settings for the proof text the user is working in: size and line height
 * as number fields, then alignment, language and script, with the shaping
 * toggle in the title row.
 */
export const TextSection = () => {
  const editor = useEditor();
  const target = useTextSettingsRun();
  if (!target) return null;

  const { run, node } = target;
  const capture = (label: string, change: () => void) => editor.history.capture(label, change);

  return (
    <SidebarSection
      title="Text"
      actions={
        <ShapingToggle
          on={run.shaping}
          onChange={(shaping) =>
            capture(shaping ? "Turn shaping on" : "Turn shaping off", () =>
              editor.text.setShaping(run.id, shaping),
            )
          }
        />
      }
    >
      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Font size"
          label={<FontSizeIcon aria-hidden className="size-4" />}
          value={node.size}
          onValueCommit={(size) =>
            capture("Set font size", () => editor.text.setSize(node.id, size))
          }
        />
        <SidebarNumberField
          ariaLabel="Line height"
          label={<LineHeightIcon aria-hidden className="size-4" />}
          value={run.lineHeight}
          placeholder="Auto"
          onValueCommit={(lineHeight) =>
            capture("Set line height", () => editor.text.setLineHeight(run.id, lineHeight))
          }
          onClear={() => capture("Set line height", () => editor.text.setLineHeight(run.id, null))}
        />
      </div>
      <Row label="Alignment">
        <AlignButtons
          runId={run.id}
          align={run.align}
          onChange={(align) => capture("Align text", () => editor.text.setAlign(run.id, align))}
        />
      </Row>
      <Row label="Language">
        <SidebarPicker
          label="Language"
          value={languageLabel(run.language)}
          unset={run.language === null}
          panel={(close) => (
            <LanguagePanel
              current={run.language}
              onPick={(language) => {
                close();
                capture("Set text language", () => editor.text.setLanguage(run.id, language));
              }}
            />
          )}
        />
      </Row>
      <Row label="Script">
        <SidebarPicker
          label="Script"
          value={run.script ? scriptName(run.script) : UNSET}
          unset={run.script === null}
          panel={(close) => (
            <ScriptPanel
              runId={run.id}
              current={run.script}
              onPick={(script) => {
                close();
                capture("Set text script", () => editor.text.setScript(run.id, script));
              }}
            />
          )}
        />
      </Row>
    </SidebarSection>
  );
};

interface ShapingToggleProps {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}

/**
 * Turns shaping on or off for the text: pressed, with the fi ligature, while
 * on; off shows f and i apart, as the text then sets them.
 */
const ShapingToggle = ({ on, onChange }: ShapingToggleProps) => {
  const Icon = on ? ShapingOnIcon : ShapingOffIcon;
  return (
    <Tooltip content="Shaping">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Shaping"
        aria-pressed={on}
        isActive={on}
        className="text-sidebar-icon"
        onClick={() => onChange(!on)}
      >
        <Icon aria-hidden className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
};

/** A setting's label, and its control at the row's end. */
const Row = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) => (
  <div className="flex h-6 items-center justify-between gap-4 text-ui">
    <span className="shrink-0 text-secondary">{label}</span>
    {children}
  </div>
);

const ALIGNMENTS: readonly { align: TextAlign; label: string; Icon: typeof AlignLeftIcon }[] = [
  { align: "left", label: "Align left", Icon: AlignLeftIcon },
  { align: "center", label: "Align center", Icon: AlignCenterIcon },
  { align: "right", label: "Align right", Icon: AlignRightIcon },
];

interface AlignButtonsProps {
  readonly runId: RunId;
  readonly align: TextAlign | null;
  readonly onChange: (align: TextAlign) => void;
}

/**
 * How lines line up. Until one is chosen, the button for where layout put
 * the first line shows pressed: right for Arabic, left for Latin.
 */
const AlignButtons = ({ runId, align, onChange }: AlignButtonsProps) => {
  const editor = useEditor();
  const direction = useSignalState(editor.text.directionCell(runId));
  // With no alignment, layout starts each line where its direction does.
  const shown = align ?? (direction === "rtl" ? "right" : "left");

  return (
    <div className="flex gap-1" role="group" aria-label="Text alignment">
      {ALIGNMENTS.map(({ align: option, label, Icon }) => (
        <IconButton
          key={option}
          ariaLabel={label}
          icon={Icon}
          pressed={shown === option}
          onClick={() => onChange(option)}
        />
      ))}
    </div>
  );
};
