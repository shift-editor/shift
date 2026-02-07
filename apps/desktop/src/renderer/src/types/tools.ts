import { ToolConstructor, ToolName } from "@/lib/tools/core";

export type ToolDescriptor = {
  id: ToolName;
  ToolClass: ToolConstructor;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
  shortcut?: string;
};
