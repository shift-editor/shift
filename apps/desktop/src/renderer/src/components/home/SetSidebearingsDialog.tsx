import { useState } from "react";
import type { GlyphId, LayerScope, MetricsKeySide } from "@shift/types";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  Toggle,
  ToggleGroup,
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

type ScopeChoice = "current" | "all";

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
  const [choice, setChoice] = useState<ScopeChoice>("current");
  const scope: LayerScope =
    choice === "current"
      ? { kind: "source", source: actions.currentSourceId }
      : { kind: "everyMaster" };
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
    setChoice("current");
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
    { label: "Left", side: "left", text: left, set: setLeft, input: leftInput },
    { label: "Right", side: "right", text: right, set: setRight, input: rightInput },
  ] as const;

  return (
    <Dialog open={glyphIds.length > 0} onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed left-1/2 top-1/2 w-80 -translate-x-1/2 -translate-y-1/2",
            "border border-line-subtle bg-surface-muted p-4",
          )}
        >
          <DialogTitle className="text-base font-medium text-primary">Set Sidebearings</DialogTitle>
          <p className="mt-1 text-sm text-secondary">
            {glyphIds.length === 1 ? "1 glyph" : `${glyphIds.length} glyphs`}. A number sets, +n or
            −n adjusts, =key links.
          </p>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <div className="flex gap-2">
              {fields.map(({ label, side, text, set, input }) => (
                <div key={side} className="flex min-w-0 flex-1 flex-col gap-1">
                  <Input
                    aria-label={`${label} sidebearing`}
                    aria-invalid={input.kind === "invalid"}
                    label={label}
                    labelPosition="right"
                    value={text}
                    autoFocus={side === "left"}
                    onChange={(event) => set(event.target.value)}
                  />
                  <span
                    role="status"
                    className={cn(
                      "min-h-3 text-xs",
                      input.kind === "invalid" ? "text-error" : "text-secondary",
                    )}
                  >
                    {note(input, side)}
                  </span>
                </div>
              ))}
            </div>
            <ToggleGroup
              aria-label="Masters to change"
              variant="segmented"
              value={[choice]}
              onValueChange={(pressed) => {
                const next = pressed.at(0);
                if (next === "current" || next === "all") setChoice(next);
              }}
            >
              <Toggle variant="segmented" value="current" className="h-full w-auto flex-1">
                <span className="text-sm">Current master</span>
              </Toggle>
              <Toggle variant="segmented" value="all" className="h-full w-auto flex-1">
                <span className="text-sm">All masters</span>
              </Toggle>
            </ToggleGroup>
            <div className="flex justify-end gap-2">
              <DialogClose render={<Button size="sm">Cancel</Button>} />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                aria-disabled={!edits || changesNothing}
              >
                Set
              </Button>
            </div>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
