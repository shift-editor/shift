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
import KerningIcon from "@/assets/toolbar/kerning.svg";
import { KerningTool } from "@shift/editor/tools";
import { useEditor } from "@/workspace/WorkspaceContext";

interface KerningValuePopoverProps {
  /** The canvas stack the tool's screen pixels are measured from. */
  readonly container: RefObject<HTMLElement | null>;
}

/**
 * Types an exact kern for the Kerning tool's open value.
 *
 * @remarks
 * Opens above the pill when its value is clicked. Arrow keys step by 1 and
 * Shift by 10, applied at once; Enter or clicking away applies a typed value
 * and closes; Escape closes without applying what was typed; Tab and
 * Shift-Tab move to the next and previous pair.
 */
export function KerningValuePopover({ container }: KerningValuePopoverProps) {
  const editor = useEditor();
  const tool = useSignalState(editor.toolCellIf("kerning"));
  useSignalState(editor.camera.viewCell);
  const cancelled = useRef(false);

  const kerning = editor.toolManager.activeTool;
  const pair = kerning instanceof KerningTool ? kerning.editing : null;
  if (!tool || !(kerning instanceof KerningTool) || !pair) return null;

  const anchor = {
    getBoundingClientRect: () => {
      const rect = kerning.editingAnchor();
      const origin = container.current?.getBoundingClientRect();
      if (!rect || !origin) return new DOMRect();
      return new DOMRect(origin.left + rect.x, origin.top + rect.y, rect.width, rect.height);
    },
  };
  const key = `${pair.gap.left.itemId}:${pair.gap.right.itemId}`;

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
        kerning.endEditing();
      }}
    >
      <PopoverPortal>
        <PopoverPositioner anchor={anchor} side="top" sideOffset={8}>
          <PopoverPopup className="min-w-0">
            <div className="flex items-center gap-1.5 pl-1.5">
              <KerningIcon aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={1.25} />
              <NumberField
                key={key}
                defaultValue={Math.round(pair.amount)}
                step={1}
                largeStep={10}
                format={{ maximumFractionDigits: 0, useGrouping: false }}
                onValueCommitted={(value) => {
                  if (cancelled.current || value === null) return;
                  kerning.setEditedKerning(value);
                }}
              >
                <NumberFieldGroup className="h-6 w-14">
                  <NumberFieldInput
                    aria-label="Kerning"
                    autoFocus
                    onFocus={(event) => {
                      cancelled.current = false;
                      event.currentTarget.select();
                    }}
                    onKeyDown={(event) => {
                      switch (event.key) {
                        case "Enter":
                          event.currentTarget.blur();
                          kerning.endEditing();
                          return;
                        case "Escape":
                          cancelled.current = true;
                          return;
                        case "Tab":
                          event.preventDefault();
                          event.currentTarget.blur();
                          kerning.editNextPair(event.shiftKey ? -1 : 1);
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
