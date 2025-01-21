import { Tool, ToolName } from "../../types/tool";
import { Editor } from "../editor/editor";
import { Pen } from "./Pen";
import { Select } from "./Select";

export class ToolRegistry {
  #tools: Map<ToolName, Tool> = new Map();
  #activeTool: Tool;

  public constructor(public editor: Editor) {
    const select = new Select(editor);
    this.#activeTool = select;

    this.#tools.set("pen", new Pen(editor));
    this.#tools.set("select", select);
  }

  public register(name: ToolName, tool: Tool) {
    this.#tools.set(name, tool);
  }

  public getTool(name: ToolName): Tool | undefined {
    if (!this.#tools.has(name)) return;
    return this.#tools.get(name);
  }

  public get activeTool(): Tool {
    return this.#activeTool;
  }

  public set activeTool(tool: ToolName) {
    const newTool = this.#tools.get(tool);
    if (!newTool) return;
    this.#activeTool = newTool;
  }
}
