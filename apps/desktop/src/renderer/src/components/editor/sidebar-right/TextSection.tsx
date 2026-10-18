import { useSignalState } from "@shift/editor/signals";
import { Switch } from "@shift/ui";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidebarSection } from "./SidebarSection";

/** Settings for the proof text the user is working in. */
export const TextSection = () => {
  const editor = useEditor();
  const run = useSignalState(editor.text.currentRunCell);
  if (!run) return null;

  return (
    <SidebarSection title="Text">
      <label className="flex items-center justify-between gap-4 text-ui text-secondary">
        Shaping
        <Switch
          checked={run.shaping}
          aria-label="Shaping"
          onCheckedChange={(shaping) =>
            editor.history.capture(shaping ? "Turn shaping on" : "Turn shaping off", () =>
              editor.text.setShaping(run.id, shaping),
            )
          }
        />
      </label>
    </SidebarSection>
  );
};
