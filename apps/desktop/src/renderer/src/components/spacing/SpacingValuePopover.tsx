import { useRef, type RefObject } from "react";
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import LeftSidebearingIcon from "@/assets/spacing/lsb.svg";
import RightSidebearingIcon from "@/assets/spacing/rsb.svg";
import { SpacingTool } from "@shift/editor/tools";
import { useEditor } from "@/workspace/WorkspaceContext";

interface SpacingValuePopoverProps {
  /** The canvas stack the tool's screen pixels are measured from. */
  readonly container: RefObject<HTMLElement | null>;
}

/**
 * Types an exact sidebearing for the Spacing tool's open value pill.
 *
 * @remarks
 * Opens above the pill when it is clicked. Arrow keys step by 1 and Shift by
 * 10, applied at once; Enter or clicking away applies a typed value and
 * closes; Escape closes without applying what was typed; Tab moves to the
 * other half of the gap.
 */
export function SpacingValuePopover({ container }: SpacingValuePopoverProps) {
  const editor = useEditor();
  const tool = useSignalState(editor.toolCell);
  useSignalState(editor.camera.viewCell);
  const cancelled = useRef(false);

  const spacing = editor.toolManager.activeTool;
  const hit = spacing instanceof SpacingTool ? spacing.editing : null;
  const half = hit ? hit.gap[hit.side] : null;
  if (tool?.id !== "spacing" || !(spacing instanceof SpacingTool) || !hit || !half) return null;

  const anchor = {
    getBoundingClientRect: () => {
      const rect = spacing.editingAnchor();
      const origin = container.current?.getBoundingClientRect();
      if (!rect || !origin) return new DOMRect();
      return new DOMRect(origin.left + rect.x, origin.top + rect.y, rect.width, rect.height);
    },
  };
  // The gap's left half is the left glyph's right sidebearing.
  const SidebearingIcon = hit.side === "left" ? RightSidebearingIcon : LeftSidebearingIcon;
  const key = `${hit.gap.left?.itemId}:${hit.gap.right?.itemId}:${hit.side}`;

  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (open) return;
        // The canvas click that opened the popover reads as an outside press;
        // canvas clicks reach the tool, which closes the popover itself.
        const onCanvas =
          details.event?.target instanceof Node &&
          container.current?.contains(details.event.target);
        if (details.reason === "outside-press" && onCanvas) return;
        spacing.endEditing();
      }}
    >
      <PopoverPortal>
        <PopoverPositioner anchor={anchor} side="top" sideOffset={8}>
          <PopoverPopup className="min-w-0">
            <div className="flex items-center gap-1.5 pl-1.5">
              <SidebearingIcon aria-hidden className="size-5 shrink-0 text-muted" />
              <NumberField
                key={key}
                defaultValue={Math.round(half.sidebearing)}
                step={1}
                largeStep={10}
                format={{ maximumFractionDigits: 0, useGrouping: false }}
                onValueCommitted={(value) => {
                  if (cancelled.current || value === null) return;
                  spacing.setEditedSidebearing(value);
                }}
              >
                <NumberFieldGroup className="h-6 w-14">
                  <NumberFieldInput
                    aria-label={hit.side === "left" ? "Right sidebearing" : "Left sidebearing"}
                    autoFocus
                    onFocus={(event) => {
                      cancelled.current = false;
                      event.currentTarget.select();
                    }}
                    onKeyDown={(event) => {
                      switch (event.key) {
                        case "Enter":
                          event.currentTarget.blur();
                          spacing.endEditing();
                          return;
                        case "Escape":
                          cancelled.current = true;
                          return;
                        case "Tab":
                          event.preventDefault();
                          event.currentTarget.blur();
                          spacing.switchEditedSide();
                          return;
                      }
                    }}
                  />
                </NumberFieldGroup>
              </NumberField>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
