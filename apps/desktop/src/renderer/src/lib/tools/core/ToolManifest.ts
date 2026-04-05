import type { BaseTool } from "./BaseTool";
import type { EditorAPI } from "./EditorAPI";
import type { ToolName } from "./createContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolFactory = (editor: EditorAPI) => BaseTool<any, any>;

export interface ToolManifest {
  id: ToolName;
  create: ToolFactory;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
  shortcut?: string;
}
