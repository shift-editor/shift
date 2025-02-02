import React, { FC } from "react";

import { tools } from "@/lib/tools/tools";
import { ToolName } from "@/types/tool";
import AppState from "@store/store";

interface ToolbarIconProps {
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
  name: ToolName;
  activeTool: ToolName;
  onClick: () => void;
}
export const ToolbarIcon: FC<ToolbarIconProps> = ({
  Icon,
  name,
  activeTool,
  onClick,
}) => {
  return (
    <div
      className={`rounded p-2 transition-colors duration-200 ${
        activeTool === name ? "bg-gray-700" : "hover:bg-gray-700"
      }`}
      onClick={onClick}
    >
      <Icon />
    </div>
  );
};

export const Toolbar = () => {
  const setActiveTool = AppState((state) => state.setActiveTool);
  const activeTool = AppState((state) => state.activeTool);

  return (
    <main className="flex h-[10vh] w-[100vw] items-center justify-center bg-[#2d2d2d]">
      <section className="flex items-center justify-center gap-2">
        {Array.from(tools.entries()).map(([name, { icon }]) => (
          <ToolbarIcon
            key={name}
            Icon={icon}
            name={name}
            activeTool={activeTool}
            onClick={() => setActiveTool(name)}
          />
        ))}
      </section>
    </main>
  );
};
