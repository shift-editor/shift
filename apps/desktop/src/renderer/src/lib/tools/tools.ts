import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import ShapeIcon from "@/assets/toolbar/shape.svg";
import { Editor } from "@/lib/editor/Editor";

import { Hand } from "./hand";
import { Pen } from "./pen";
import { Select } from "./select";
import { Shape } from "./shape";

export function registerBuiltInTools(editor: Editor): void {
  editor.registerTool("select", Select, SelectIcon, "Select Tool (V)");
  editor.registerTool("pen", Pen, PenIcon, "Pen Tool (P)");
  editor.registerTool("hand", Hand, HandIcon, "Hand Tool (H)");
  editor.registerTool("shape", Shape, ShapeIcon, "Shape Tool (S)");
}
