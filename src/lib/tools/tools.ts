import { Tool } from "../../types/tool";

import { ToolName } from "../../types/tool";
import { Select } from "./Select";
import { Pen } from "./Pen";

export const tools = new Map<ToolName, Tool>();

tools.set("select", new Select());
tools.set("pen", new Pen());
