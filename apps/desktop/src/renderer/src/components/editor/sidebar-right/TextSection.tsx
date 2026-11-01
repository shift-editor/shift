import { useSignalState } from "@shift/editor/signals";
import { Button, Tooltip } from "@shift/ui";
import ShapingOffIcon from "@/assets/general/shaping-off.svg";
import ShapingOnIcon from "@/assets/general/shaping-on.svg";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarSection } from "./SidebarSection";

/** Settings for the proof text the user is working in. */
export const TextSection = () => {
  const editor = useEditor();
  const run = useSignalState(editor.text.currentRunCell);
  if (!run) return null;

  const setShaping = (shaping: boolean) =>
    editor.history.capture(shaping ? "Turn shaping on" : "Turn shaping off", () =>
      editor.text.setShaping(run.id, shaping),
    );

  return (
    <SidebarSection
      title="Text"
      actions={<ShapingToggle on={run.shaping} onChange={setShaping} />}
    />
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
