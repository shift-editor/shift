import type { CommandId } from "@shared/commands";
import { ContextMenuItem, ContextMenuSeparator } from "@shift/ui";
import { availableStrokeCommands } from "@/lib/commands/strokeCommands";
import type { StrokeContextCommandId } from "@/types/stroke";
import { useEditor } from "@/workspace/WorkspaceContext";

const STROKE_CONTEXT_ITEMS: readonly { id: StrokeContextCommandId; label: string }[] = [
  { id: "glyph.stroke.applyDynamic", label: "Add Dynamic Stroke" },
  { id: "glyph.stroke.removeDynamic", label: "Remove Dynamic Stroke" },
  { id: "glyph.stroke.expand", label: "Expand Stroke" },
  { id: "glyph.stroke.offsetContour", label: "Offset Contour…" },
];

const STROKE_CONTEXT_IDS = STROKE_CONTEXT_ITEMS.map(({ id }) => id);

interface StrokeContextItemsProps {
  readonly onRun: (id: CommandId) => Promise<void>;
}

/**
 * The stroke commands the canvas context menu offers: only those that would run on the
 * selection, so the menu never lists a command that refuses.
 *
 * @remarks
 * Read when the menu's popup mounts, after the right-click has selected its target, so a stroke
 * just added or removed shows in the next menu.
 */
export const StrokeContextItems = ({ onRun }: StrokeContextItemsProps) => {
  const editor = useEditor();
  const available = new Set(availableStrokeCommands(editor, STROKE_CONTEXT_IDS));
  const items = STROKE_CONTEXT_ITEMS.filter(({ id }) => available.has(id));
  if (items.length === 0) return null;

  return (
    <>
      <ContextMenuSeparator />
      {items.map(({ id, label }) => (
        <ContextMenuItem key={id} onClick={async () => onRun(id)}>
          {label}
        </ContextMenuItem>
      ))}
    </>
  );
};
