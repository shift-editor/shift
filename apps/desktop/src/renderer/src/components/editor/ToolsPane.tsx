import { FC } from "react";

import {
  Button,
  Toolbar,
  ToolbarButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "@shift/ui";
import { useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SVG } from "@/types/common";
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
    <Tooltip delayDuration={1500}>
      <TooltipTrigger>
        <ToolbarButton
          disabled={disabled}
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
              disabled={disabled}
              isActive={isActive}
              onClick={onClick}
              size="icon"
            />
          }
        />
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={5}
        className="bg-surface px-2 py-1 text-primary border shadow-sm"
      >
        <p className="mb-1 font-sans text-[0.6rem] font-light">{tooltip}</p>
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
      <TooltipProvider delayDuration={2000}>
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
      </TooltipProvider>
    </section>
  );
};
