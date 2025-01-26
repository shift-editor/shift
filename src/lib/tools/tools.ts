import { Tool } from "../../types/tool";

import { ToolName } from "../../types/tool";
import { Pen } from "./Pen";
import { Select } from "./Select";

export const tools = new Map<ToolName, Tool>();

tools.set("select", new Select());
tools.set("pen", new Pen());
