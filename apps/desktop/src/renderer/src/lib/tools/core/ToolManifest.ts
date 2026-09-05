import type { BaseTool } from "./BaseTool";
import type { Editor } from "@/lib/editor/Editor";
import type { Signal } from "@/lib/signals";
import type { ToolName } from "./createContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolFactory = (editor: Editor) => BaseTool<any, any, any>;

export interface ToolMenuItem {
  id: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
  shortcut: string;
  selected: boolean;
  onSelect: () => void;
}

export interface ToolManifest {
  id: ToolName;
  create: ToolFactory;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
  shortcut?: string;
  onSelect?: () => void;
  menuItems?: readonly ToolMenuItem[];
  menuSelectionCell?: Signal<string>;
  hidden?: boolean;
  disabled?: boolean;
}
