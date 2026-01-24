import { FC } from "react";

import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@shift/ui";
import { useValue } from "@/lib/reactive";
import AppState, { getEditor } from "@/store/store";
import { Svg } from "@/types/common";
import { ToolName } from "@/types/tool";
import { cn } from "@/lib/utils";

interface ToolbarIconProps {
  Icon: Svg;
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
  return (
    <Tooltip delayDuration={1500}>
      <TooltipTrigger>
        <Button
          className={cn(
            "h-7 w-7 p-1 rounded-md",
            activeTool === name && "bg-accent hover:bg-accent",
          )}
          icon={
            <Icon
              width={18}
              height={18}
              className={activeTool === name ? "text-white" : "text-primary"}
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
  const fileName = AppState((state) => state.fileName);
  const isDirty = AppState((state) => state.isDirty);

  const activeTool = useValue(editor.activeTool);

  const displayName = fileName ?? "Untitled";
  const title = isDirty ? `${displayName}*` : displayName;

  return (
    <section className="flex flex-col items-center justify-center gap-2">
      <h1 className="text-xs font-[400] mt-0.5">{title}</h1>
      <TooltipProvider delayDuration={2000}>
        <div className="flex items-center gap-2 bg-white rounded-lg border-b border-line p-0.5">
          {Array.from(editor.tools.entries()).map(
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
