import { FC } from "react";

import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "@shift/ui";
import { useSignalState } from "@/lib/signals";
import { getEditor } from "@/store/store";
import { SVG } from "@/types/common";
import type { ToolName } from "@/lib/tools/core";

interface ToolbarIconProps {
  Icon: SVG;
  name: ToolName;
  tooltip: string;
  activeTool: ToolName;
  onClick: () => void;
}
export const ToolbarIcon: FC<ToolbarIconProps> = ({
  Icon,
  name,
  tooltip,
  activeTool,
  onClick,
}) => {
  const isActive = activeTool === name;

  return (
    <Tooltip delayDuration={1500}>
      <TooltipTrigger>
        <Button
          className={cn("w-7 h-7 rounded-md")}
          variant={isActive ? "primary" : "ghost"}
          icon={
            <Icon
              className={cn(
                "w-full h-full",
                isActive ? "text-white" : "text-primary",
              )}
            />
          }
          aria-label={tooltip}
          isActive={isActive}
          onClick={onClick}
          size="icon"
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
  const editor = getEditor();
  const activeTool = useSignalState(editor.activeToolCell);

  return (
    <section className="flex flex-col items-center justify-center gap-2">
      <TooltipProvider delayDuration={2000}>
        <div className="flex items-center gap-2 bg-white rounded-lg border-b border-line p-0.5">
          {Array.from(editor.toolRegistry.entries()).map(
            ([name, { icon, tooltip }]) => (
              <ToolbarIcon
                key={name}
                Icon={icon}
                name={name}
                tooltip={tooltip}
                activeTool={activeTool}
                onClick={() => {
                  editor.setActiveTool(name);
                }}
              />
            ),
          )}
        </div>
      </TooltipProvider>
    </section>
  );
};
