import { FC } from "react";

import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@shift/ui";
import { useValue } from "@/lib/reactive";
import { getEditor } from "@/store/store";
import { Svg } from "@/types/common";
import type { ToolName } from "@/lib/tools/core";

interface ToolbarIconProps {
  Icon: Svg;
  name: ToolName;
  tooltip: string;
  activeTool: ToolName;
  onClick: () => void;
}
export const ToolbarIcon: FC<ToolbarIconProps> = ({ Icon, name, tooltip, activeTool, onClick }) => {
  return (
    <Tooltip delayDuration={1500}>
      <TooltipTrigger>
        <Button
          className={cn("w-7 h-7 rounded-md", activeTool === name && "bg-accent hover:bg-accent")}
          icon={
            <Icon
              className={cn("w-full h-full", activeTool === name ? "text-white" : "text-primary")}
            />
          }
          aria-label={tooltip}
          variant="ghost"
          isActive={activeTool === name}
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
  const activeTool = useValue(editor.activeTool);

  return (
    <section className="flex flex-col items-center justify-center gap-2">
      <TooltipProvider delayDuration={2000}>
        <div className="flex items-center gap-2 bg-white rounded-lg border-b border-line p-0.5">
          {Array.from(editor.tools.entries()).map(([name, { icon, tooltip }]) => (
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
          ))}
        </div>
      </TooltipProvider>
    </section>
  );
};
