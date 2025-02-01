import { Tool } from "../../types/tool";

import { ToolName } from "../../types/tool";
import { Hand } from "./Hand";
import { Pen } from "./Pen";
import { Select } from "./Select";

export const tools = new Map<ToolName, Tool>();

tools.set("select", new Select());
tools.set("pen", new Pen());
tools.set("hand", new Hand());
