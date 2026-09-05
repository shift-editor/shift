import type { FC } from "react";

import {
  Button,
  Toolbar,
  ToolbarButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@shift/ui";
import { useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { SVG } from "@/types/common";
import type { ToolName } from "@/lib/tools/core";

interface ToolbarIconProps {
  Icon: SVG;
  name: ToolName;
  tooltip: string;
  activeTool: ToolName | null;
  disabled?: boolean;
  onClick?: () => void;
}
export const ToolbarIcon: FC<ToolbarIconProps> = ({
  Icon,
  name,
  tooltip,
  activeTool,
  disabled,
  onClick,
}) => {
  const isActive = activeTool === name;

  return (
    <Tooltip>
      <TooltipTrigger>
        <ToolbarButton
          render={
            <Button
              className={cn("h-8 w-8 rounded-md", !isActive && "hover:bg-icon-button-hover")}
              variant={isActive ? "primary" : "ghost"}
              icon={
                <Icon
                  className={cn("h-5.5 w-5.5", isActive ? "text-white" : "text-primary")}
                  strokeWidth={1.25}
                />
              }
              aria-label={tooltip}
              aria-disabled={disabled || undefined}
              isActive={isActive}
              onClick={() => {
                if (disabled) return;

                if (onClick) onClick();
              }}
              size="icon"
            />
          }
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={5}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

export const ToolsPane: FC = () => {
  const editor = useEditor();
  const activeTool = useSignalState(editor.toolCell)?.id ?? null;
  const toolRegistry = useSignalState(editor.toolRegistryCell);

  return (
    <section className="flex flex-col items-center justify-center gap-2">
      <Toolbar
        aria-label="Editor tools"
        className="flex h-[40px] items-center gap-2 overflow-hidden rounded-lg border-b border-line bg-white px-1"
      >
        {Array.from(toolRegistry.entries())
          .filter(([, item]) => !item.hidden)
          .map(([name, { icon, tooltip, disabled }]) => (
            <ToolbarIcon
              key={name}
              Icon={icon}
              name={name}
              tooltip={tooltip}
              activeTool={activeTool}
              disabled={disabled}
              onClick={() => {
                editor.setActiveTool(name);
              }}
            />
          ))}
      </Toolbar>
    </section>
  );
};
