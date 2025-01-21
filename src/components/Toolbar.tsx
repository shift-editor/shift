import PenIcon from "../assets/toolbar/pen.svg";
import SelectIcon from "../assets/toolbar/select.svg";
import { ToolRegistry } from "../lib/tools/ToolRegistry";

export interface ToolbarProps {
  toolRegistry: ToolRegistry;
}

export const Toolbar = ({ toolRegistry }: ToolbarProps) => {
  return (
    <main className="flex items-center justify-center w-[100vw] h-[10vh] bg-[#2d2d2d]">
      <section className="flex items-center justify-center gap-2">
        <div onClick={() => (toolRegistry.activeTool = "select")}>
          <SelectIcon />
        </div>
        <div>
          <PenIcon />
        </div>
      </section>
    </main>
  );
};
