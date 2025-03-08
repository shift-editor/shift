import { FC } from "react";

import { tools } from "@/lib/tools/tools";
import AppState from "@/store/store";
import { ToolName } from "@/types/tool";

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
      className={`rounded p-1 transition-colors duration-200 ${
        activeTool === name ? "bg-[#4a4a54]" : "hover:bg-[#4a4a54]"
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
    <main className="flex h-[7.5vh] w-screen items-center justify-center bg-[#2d2d2d]">
      <section className="flex items-center justify-center gap-2">
        {Array.from(tools.entries()).map(([name, { icon }]) => (
          <ToolbarIcon
            key={name}
            Icon={icon}
            name={name}
            activeTool={activeTool}
            onClick={() => {
              setActiveTool(name);
            }}
          />
        ))}
      </section>
    </main>
  );
};
