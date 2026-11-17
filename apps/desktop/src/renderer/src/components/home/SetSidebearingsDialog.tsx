import { useState } from "react";
import type { GlyphId, LayerScope, MetricsKeySide } from "@shift/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  Tooltip,
  X,
  cn,
} from "@shift/ui";
import type { GridActions } from "@/lib/glyph-grid/gridActions";
import { readSidebearingInput, type SidebearingInput } from "@/lib/glyph-grid/sidebearingInput";

interface SetSidebearingsDialogProps {
  /** The glyphs to edit; the dialog is open while there are any. */
  readonly glyphIds: readonly GlyphId[];
  readonly actions: GridActions;
  /** Why a metrics key cannot be read, or null when it can. */
  readonly keyProblem: (key: string) => string | null;
  readonly onClose: () => void;
}

/**
 * Sets the sidebearings of the selected glyphs at once. Each field takes a
 * number to set, `+n` or `−n` to adjust, or `=key` to link; blank leaves the
 * side as it is. Glyphs that draw nothing are skipped.
 */
export function SetSidebearingsDialog({
  glyphIds,
  actions,
  keyProblem,
  onClose,
}: SetSidebearingsDialogProps) {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [allMasters, setAllMasters] = useState(false);
  const scope: LayerScope = allMasters
    ? { kind: "everyMaster" }
    : { kind: "source", source: actions.currentSourceId };
  const leftInput = readSidebearingInput(left, keyProblem);
  const rightInput = readSidebearingInput(right, keyProblem);
  const edits =
    leftInput.kind === "edit" && rightInput.kind === "edit"
      ? { left: leftInput.edit, right: rightInput.edit }
      : null;
  const changesNothing = edits?.left.kind === "keep" && edits.right.kind === "keep";
  const close = () => {
    setLeft("");
    setRight("");
    setAllMasters(false);
    onClose();
  };
  const apply = () => {
    if (!edits || changesNothing) return;
    actions.setSidebearings(glyphIds, scope, edits.left, edits.right);
    close();
  };
  /** What to say under a field: why it is invalid, or how many linked sides an adjustment skips. */
  const note = (input: SidebearingInput, side: MetricsKeySide): string | null => {
    if (input.kind === "invalid") return input.problem;
    if (input.edit.kind !== "adjust") return null;

    const skipped = actions.linkedSideCount(glyphIds, scope, side);
    if (skipped === 0) return null;
    return `${skipped} linked ${skipped === 1 ? "side" : "sides"} skipped`;
  };
  const fields = [
    // Each label sits on its own side's edge.
    { label: "Left", side: "left", text: left, set: setLeft, input: leftInput },
    { label: "Right", side: "right", text: right, set: setRight, input: rightInput },
  ] as const;

  return (
    <Dialog open={glyphIds.length > 0} onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        <DialogBackdrop variant="light" />
        {/* Styled as the app's popovers are: a title row, the fields, and a row of actions. */}
        <DialogPopup variant="panel" className="top-1/3 w-70 max-w-none">
          <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pr-1 pl-2">
            <DialogTitle variant="panel">Set Sidebearings</DialogTitle>
            <Tooltip content="Close">
              <DialogClose variant="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </DialogClose>
            </Tooltip>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-1.5">
                {fields.map(({ label, side, text, set, input }) => {
                  const fieldNote = note(input, side);
                  return (
                    <div key={side} className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Input
                        aria-label={`${label} sidebearing`}
                        aria-invalid={input.kind === "invalid"}
                        label={label}
                        labelPosition={side}
                        // The value sits at the edge away from its label: the left field types from the right.
                        className={side === "left" ? "text-right" : undefined}
                        value={text}
                        autoFocus={side === "left"}
                        onChange={(event) => set(event.target.value)}
                      />
                      {/* Only a field with something to say gets a line under it. */}
                      {fieldNote ? (
                        <span
                          role="status"
                          className={cn(
                            "text-ui",
                            input.kind === "invalid" ? "text-error" : "text-secondary",
                          )}
                        >
                          {fieldNote}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-1.5 border-t border-line-subtle p-2">
              {/* The edit changes the current master unless it is ticked. */}
              <label className="mr-auto flex cursor-pointer select-none items-center gap-1.5 pl-1 text-ui text-primary">
                <Checkbox checked={allMasters} onCheckedChange={setAllMasters} />
                All masters
              </label>
              <DialogClose render={<Button variant="ghost" size="compact" />}>Cancel</DialogClose>
              <Button
                type="submit"
                variant="outline"
                size="compact"
                aria-disabled={!edits || changesNothing}
              >
                <span className="flex items-center gap-2">
                  Set
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
