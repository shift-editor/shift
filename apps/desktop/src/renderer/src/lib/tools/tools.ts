import CircleIcon from "@/assets/toolbar/circle.svg";
import HandIcon from "@/assets/toolbar/hand.svg";
import PenIcon from "@/assets/toolbar/pen.svg";
import SelectIcon from "@/assets/toolbar/select.svg";
import ShapeIcon from "@/assets/toolbar/shape.svg";
import TextIcon from "@/assets/toolbar/text.svg";

import type { Editor } from "@shift/editor";
import { signal } from "@shift/editor/signals";
import type { ToolManifest } from "@shift/editor/tools";

import { Hand } from "@shift/editor/tools";
import { Pen } from "@shift/editor/tools";
import { Select } from "@shift/editor/tools";
import { ShapeTool, type ShapeKind } from "@shift/editor/tools";
import { TextTool } from "@shift/editor/tools";

function builtInToolManifests(): readonly ToolManifest[] {
  const shapeKindCell = signal<ShapeKind>("rectangle", { name: "tool.Shape.kind" });
  const selectRectangle = () => {
    shapeKindCell.set("rectangle");
  };
  const selectEllipse = () => {
    shapeKindCell.set("ellipse");
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
      create: (api) => new ShapeTool(api, shapeKindCell),
      get icon() {
        return shapeKindCell.peek() === "ellipse" ? CircleIcon : ShapeIcon;
      },
      get tooltip() {
        return shapeKindCell.peek() === "ellipse" ? "Ellipse Tool (O)" : "Rectangle Tool (R)";
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
          id: "ellipse",
          icon: CircleIcon,
          label: "Ellipse",
          shortcut: "o",
          get selected() {
            return shapeKindCell.peek() === "ellipse";
          },
          onSelect: selectEllipse,
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
