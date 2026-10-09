import { useEffect, useState } from "react";
import { Button, Minus, Square, Tooltip, TooltipContent, TooltipTrigger, X } from "@shift/ui";
import type { CommandId } from "@shared/commands";
import type { WindowButton, WindowButtonLayout } from "@shared/menu/types";
import { getShiftHost } from "@/host/shiftHost";

const BUTTONS: Record<WindowButton, { label: string; command: CommandId; icon: typeof X }> = {
  minimize: { label: "Minimize", command: "window.minimise", icon: Minus },
  maximize: { label: "Maximize", command: "window.maximise", icon: Square },
  close: { label: "Close", command: "window.close", icon: X },
};

let layoutRequest: Promise<WindowButtonLayout | null> | null = null;

/**
 * Minimize, maximize, and close, drawn in Shift's style on Linux.
 *
 * @remarks
 * Linux windows are frameless, so Shift draws these itself, at the start or end
 * of the title-bar row as the desktop's button layout says. Renders nothing on
 * macOS and Windows, where the system or the renderer's traffic lights do it.
 *
 * @param side - which end of the row this instance fills.
 */
export const WindowControls = ({ side }: { side: "start" | "end" }) => {
  const layout = useWindowButtonLayout();
  const buttons = layout?.[side] ?? [];
  if (buttons.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Window controls"
      className="flex shrink-0 items-center gap-1 px-2"
    >
      {buttons.map((button) => {
        const { label, command, icon: Icon } = BUTTONS[button];
        return (
          <Tooltip key={button}>
            <TooltipTrigger>
              <Button
                icon={<Icon width={16} height={16} />}
                aria-label={label}
                variant="toolbar"
                size="icon"
                onClick={() => runCommand(command)}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};

/** The desktop's button layout, read once per window; null on macOS and Windows. */
export function useWindowButtonLayout(): WindowButtonLayout | null {
  const [layout, setLayout] = useState<WindowButtonLayout | null>(null);

  useEffect(() => {
    let current = true;
    void loadLayout((next) => {
      if (current) setLayout(next);
    });
    return () => {
      current = false;
    };
  }, []);

  return layout;
}

async function loadLayout(publish: (layout: WindowButtonLayout | null) => void): Promise<void> {
  try {
    layoutRequest ??= getShiftHost().window.buttonLayout();
    publish(await layoutRequest);
  } catch (error) {
    console.error("reading the window button layout failed", error);
  }
}

async function runCommand(command: CommandId): Promise<void> {
  try {
    await getShiftHost().commands.run(command);
  } catch (error) {
    console.error("window control failed", command, error);
  }
}
