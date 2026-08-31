import CircleIcon from "@/assets/toolbar/circle.svg";
import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import ShapeIcon from "@/assets/toolbar/shape.svg";
import TextIcon from "@/assets/toolbar/text.svg";

import type { Editor } from "@/lib/editor/Editor";
import { signal } from "@/lib/signals";
import type { ToolManifest } from "./core";

import { Hand } from "./hand";
import { Pen } from "./pen";
import { Select } from "./select";
import { Shape, type ShapeKind } from "./shape";
import { TextTool } from "./text/Text";

function builtInToolManifests(): readonly ToolManifest[] {
  const shapeKindCell = signal<ShapeKind>("rectangle", { name: "tool.Shape.kind" });
  const selectRectangle = () => {
    shapeKindCell.set("rectangle");
  };
  const selectCircle = () => {
    shapeKindCell.set("circle");
  };

  return [
    {
      id: "select",
      create: (api) => new Select(api),
      icon: SelectIcon,
      tooltip: "Select Tool (V)",
      shortcut: "v",
    },
    {
      id: "pen",
      create: (api) => new Pen(api),
      icon: PenIcon,
      tooltip: "Pen Tool (P)",
      shortcut: "p",
    },
    {
      id: "hand",
      create: (api) => new Hand(api),
      icon: HandIcon,
      tooltip: "Hand Tool (H)",
      shortcut: "h",
    },
    {
      id: "shape",
      create: (api) => new Shape(api, shapeKindCell),
      get icon() {
        return shapeKindCell.peek() === "circle" ? CircleIcon : ShapeIcon;
      },
      get tooltip() {
        return shapeKindCell.peek() === "circle" ? "Circle Tool (O)" : "Rectangle Tool (R)";
      },
      shortcut: "r",
      onSelect: selectRectangle,
      menuSelectionCell: shapeKindCell,
      menuItems: [
        {
          id: "rectangle",
          icon: ShapeIcon,
          label: "Rectangle",
          shortcut: "r",
          get selected() {
            return shapeKindCell.peek() === "rectangle";
          },
          onSelect: selectRectangle,
        },
        {
          id: "circle",
          icon: CircleIcon,
          label: "Circle",
          shortcut: "o",
          get selected() {
            return shapeKindCell.peek() === "circle";
          },
          onSelect: selectCircle,
        },
      ],
    },
    {
      id: "text",
      create: (api) => new TextTool(api),
      icon: TextIcon,
      tooltip: "Text Tool (T)",
      shortcut: "t",
      hidden: true,
      disabled: true,
    },
  ];
}

export function registerBuiltInTools(editor: Editor): void {
  for (const manifest of builtInToolManifests()) {
    manifest.disabled =
      manifest.disabled ||
      (editor.sessionMode === "preview" && (manifest.id === "pen" || manifest.id === "shape"));

    editor.registerTool(manifest);
  }
}
