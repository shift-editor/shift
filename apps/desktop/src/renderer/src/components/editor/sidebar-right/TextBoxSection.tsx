import { useMemo } from "react";
import { Bounds } from "@shift/geo";
import { computed, track, useSignalState, type Signal } from "@shift/editor/signals";
import type { Editor } from "@shift/editor";
import type { Sizing, TextRunNode, TextVerticalAlign } from "@shift/editor/types";
import type { NodeId } from "@shift/types";
import { LabelledSelect } from "./LabelledSelect";
import { SidebarNumberField } from "./SidebarNumberField";
import { SidebarSection } from "./SidebarSection";
import { useEditor } from "@/workspace/WorkspaceContext";

const SIZING_LABELS: Record<Sizing["kind"], string> = {
  hug: "Auto",
  fixed: "Fixed",
};

const VERTICAL_ALIGN_LABELS: Record<TextVerticalAlign, string> = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
};

/** What the section shows about a box: its record, its size. */
interface TextBoxState {
  readonly node: TextRunNode;
  /** The box's width on the canvas, in scene units. */
  readonly width: number;
  /** The box's height on the canvas, in scene units. */
  readonly height: number;
}

/** The selected text box's font size, and how its width and height follow its text. */
export const TextBoxSection = ({ nodeId }: { readonly nodeId: NodeId }) => {
  const editor = useEditor();
  const stateCell = useMemo(() => textBoxCell(editor, nodeId), [editor, nodeId]);
  const state = useSignalState(stateCell);
  if (!state) return null;

  const { node, width, height } = state;

  return (
    <SidebarSection title="Text">
      <SidebarNumberField
        ariaLabel="Font size"
        label="Size"
        value={node.size}
        onValueCommit={(size) => editor.text.setSize(nodeId, size)}
      />
      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Width"
          label="W"
          value={Math.round(node.width.kind === "fixed" ? node.width.size : width)}
          onValueCommit={(value) =>
            editor.text.setWidth(nodeId, { kind: "fixed", size: Math.max(0, value) })
          }
        />
        <LabelledSelect
          label="Width sizing"
          value={node.width.kind}
          labels={SIZING_LABELS}
          onChange={(kind) =>
            editor.text.setWidth(
              nodeId,
              kind === "fixed" ? { kind, size: Math.round(width) } : { kind },
            )
          }
          hideLabel
        />
      </div>
      <div className="flex gap-2">
        <SidebarNumberField
          ariaLabel="Height"
          label="H"
          value={Math.round(node.height.kind === "fixed" ? node.height.size : height)}
          onValueCommit={(value) =>
            editor.text.setHeight(nodeId, { kind: "fixed", size: Math.max(0, value) })
          }
        />
        <LabelledSelect
          label="Height sizing"
          value={node.height.kind}
          labels={SIZING_LABELS}
          onChange={(kind) =>
            editor.text.setHeight(
              nodeId,
              kind === "fixed" ? { kind, size: Math.round(height) } : { kind },
            )
          }
          hideLabel
        />
      </div>
      <LabelledSelect
        label="Vertical align"
        value={node.verticalAlign}
        labels={VERTICAL_ALIGN_LABELS}
        onChange={(align) => editor.text.setVerticalAlign(nodeId, align)}
      />
    </SidebarSection>
  );
};

/** The box's record and size; quiet while it only moves or turns. */
function textBoxCell(editor: Editor, nodeId: NodeId): Signal<TextBoxState | null> {
  return computed(
    () => {
      const node = editor.scene.record(nodeId);
      if (node?.kind !== "textRun") return null;

      track(editor.font.metricsCell);
      // The box's own sides, not its scene extent, which grows when it turns.
      const bounds = editor.nodeDefinition("textRun").bounds(node);
      const scale = node.size / editor.font.metricsCell.peek().unitsPerEm;
      return {
        node,
        width: bounds ? Bounds.width(bounds) * scale : 0,
        height: bounds ? Bounds.height(bounds) * scale : 0,
      };
    },
    { name: "TextBoxSection.box", equals: sameTextBox },
  );
}

/** Whether two states differ only in what the section does not show, such as position. */
function sameTextBox(a: TextBoxState | null, b: TextBoxState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.node.id === b.node.id &&
    a.node.size === b.node.size &&
    a.node.width === b.node.width &&
    a.node.height === b.node.height &&
    a.node.verticalAlign === b.node.verticalAlign &&
    a.width === b.width &&
    a.height === b.height
  );
}
