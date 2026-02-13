import type { BaseTool, ToolState } from "./BaseTool";
import type { EditorAPI } from "./EditorAPI";
import type { ToolName } from "./createContext";
import type { ToolRenderContributor } from "./ToolRenderContributor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolFactory = (editor: EditorAPI) => BaseTool<ToolState, any>;

export interface ToolManifest {
  id: ToolName;
  create: ToolFactory;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  tooltip: string;
  shortcut?: string;
  renderContributors?: readonly ToolRenderContributor[];
}
