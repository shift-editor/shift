import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import ShapeIcon from "@/assets/toolbar/shape.svg";
import { Editor } from "@/lib/editor/Editor";

import { Hand } from "./Hand";
import { Pen } from "./pen";
import { Select } from "./select";
import { Shape } from "./Shape";

/**
 * Register all built-in tools with the editor.
 * This should be called once when the editor is created.
 */
export function registerBuiltInTools(editor: Editor): void {
  editor.registerTool("select", new Select(editor), SelectIcon, "Select Tool (V)");
  editor.registerTool("pen", new Pen(editor), PenIcon, "Pen Tool (P)");
  editor.registerTool("hand", new Hand(editor), HandIcon, "Hand Tool (H)");
  editor.registerTool("shape", new Shape(editor), ShapeIcon, "Shape Tool (S)");
}
