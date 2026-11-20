import { useState } from "react";
import type { StrokeJoin } from "@shift/types";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  Tooltip,
  X,
} from "@shift/ui";
import {
  DEFAULT_OFFSET_FIELDS,
  offsetContourFromFields,
  readOffsetInput,
} from "@/lib/commands/strokeOffsetInput";
import type { StrokeOffsetFields } from "@/types/stroke";
import { useEditor } from "@/workspace/WorkspaceContext";
import { IconButton } from "./sidebar-right/IconButton";
import { SidebarRow } from "./sidebar-right/SidebarRow";
import { JOINS } from "./sidebar-right/strokeChoices";

interface OffsetContourDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface OpenOffsetContourDialogProps {
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Offset Contour…: moves the selected contour a signed distance to one side of its path.
 *
 * @remarks
 * Mounts its contents only while open, so every opening starts from the default fields.
 */
export function OffsetContourDialog({ open, onOpenChange }: OffsetContourDialogProps) {
  if (!open) return null;

  return <OpenOffsetContourDialog onOpenChange={onOpenChange} />;
}

function OpenOffsetContourDialog({ onOpenChange }: OpenOffsetContourDialogProps) {
  const editor = useEditor();
  const [fields, setFields] = useState<StrokeOffsetFields>(DEFAULT_OFFSET_FIELDS);
  // Why the engine or the selection refused the last Apply; typing again clears it.
  const [refusal, setRefusal] = useState<string | null>(null);

  const input = readOffsetInput(fields);
  const problem = input.kind === "invalid" ? input.problem : refusal;

  const edit = (patch: Partial<StrokeOffsetFields>) => {
    setFields((current) => ({ ...current, ...patch }));
    setRefusal(null);
  };

  const apply = async () => {
    if (input.kind === "invalid") return;

    const result = offsetContourFromFields(editor, fields);
    if (!result.ok) {
      setRefusal(result.reason);
      return;
    }

    try {
      await editor.font.editCoordinator.settled();
    } catch (error) {
      console.error("offset contour did not settle", error);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop variant="light" />
        <DialogPopup variant="panel" className="top-1/3 w-70 max-w-none">
          <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pr-1 pl-2">
            <DialogTitle variant="panel">Offset Contour</DialogTitle>
            <Tooltip content="Close">
              <DialogClose variant="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </DialogClose>
            </Tooltip>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              await apply();
            }}
          >
            <div className="flex flex-col gap-2 p-2">
              <SidebarRow label="Distance">
                <div className="w-24">
                  <Input
                    aria-label="Offset distance"
                    aria-invalid={input.kind === "invalid"}
                    inputMode="decimal"
                    className="text-right"
                    value={fields.distance}
                    autoFocus
                    onChange={(event) => edit({ distance: event.target.value })}
                  />
                </div>
              </SidebarRow>
              <p className="text-ui text-secondary">
                Negative moves the contour left of its direction, positive moves it right.
              </p>
              <SidebarRow label="Join">
                <JoinChoice join={fields.join} onChange={(join) => edit({ join })} />
              </SidebarRow>
              {fields.join === "miter" ? (
                <SidebarRow label="Miter limit">
                  <div className="w-24">
                    <Input
                      aria-label="Miter limit"
                      inputMode="decimal"
                      className="text-right"
                      value={fields.miterLimit}
                      onChange={(event) => edit({ miterLimit: event.target.value })}
                    />
                  </div>
                </SidebarRow>
              ) : null}
              {problem ? (
                <span role="alert" className="text-ui text-error">
                  {problem}
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-1.5 border-t border-line-subtle p-2">
              <DialogClose render={<Button variant="ghost" size="compact" />}>Cancel</DialogClose>
              <Button
                type="submit"
                variant="outline"
                size="compact"
                aria-disabled={input.kind === "invalid"}
              >
                <span className="flex items-center gap-2">
                  Offset
                  <kbd aria-hidden className="font-ui text-ui text-secondary">
                    ↵
                  </kbd>
                </span>
              </Button>
            </div>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

interface JoinChoiceProps {
  readonly join: StrokeJoin;
  readonly onChange: (join: StrokeJoin) => void;
}

/** The three joins as the Stroke section shows them: one pressed. */
const JoinChoice = ({ join, onChange }: JoinChoiceProps) => (
  <div className="flex gap-1" role="group" aria-label="Offset join">
    {JOINS.map(({ join: choice, label, Icon }) => (
      <IconButton
        key={choice}
        ariaLabel={label}
        icon={Icon}
        pressed={join === choice}
        onClick={() => onChange(choice)}
      />
    ))}
  </div>
);
