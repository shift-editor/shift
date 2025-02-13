import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import { Editor } from "@/lib/editor/Editor";
import { ToolName, Tool } from "@/types/tool";

import { Hand } from "./Hand";
import { Pen } from "./pen";
import { Select } from "./Select";

export interface ToolRegistryItem {
  tool: Tool;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

export const tools = new Map<ToolName, ToolRegistryItem>();

export const createToolRegistry = (editor: Editor) => {
  tools.set("select", { tool: new Select(), icon: SelectIcon });
  tools.set("pen", { tool: new Pen(), icon: PenIcon });
  tools.set("hand", { tool: new Hand(editor), icon: HandIcon });
};
