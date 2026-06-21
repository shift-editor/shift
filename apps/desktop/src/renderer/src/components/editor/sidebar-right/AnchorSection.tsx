import { useRef } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { getEditor } from "@/store/appStore";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { useState } from "react";
import type { AnchorId } from "@shift/types";

export const AnchorSection = () => {
  const editor = getEditor();

  const [singleAnchorId, setSingleAnchorId] = useState<AnchorId | null>(null);

  const [anchorName, setAnchorName] = useState<string | null>(null);
  const [hasLayer, setHasLayer] = useState(false);

  const [anchorX, setAnchorX] = useState(0);
  const [anchorY, setAnchorY] = useState(0);

  const xRef = useRef<EditableSidebarInputHandle>(null);
  const yRef = useRef<EditableSidebarInputHandle>(null);

  useSignalEffect(() => {
    const instance = editor.glyphInstanceCell.value;
    const ids = [...editor.selection.stateCell.value.anchorIds];

    setHasLayer(instance?.hasLayer ?? false);

    if (!instance || ids.length !== 1) {
      setSingleAnchorId(null);
      setAnchorName(ids.length > 1 ? "Multiple" : null);
      setAnchorX(0);
      setAnchorY(0);
      xRef.current?.setValue(0);
      yRef.current?.setValue(0);
      return;
    }

    const selected = ids[0] ? instance.geometry.anchor(ids[0]) : null;
    if (!selected) {
      setSingleAnchorId(null);
      setAnchorName(null);
      return;
    }

    setSingleAnchorId(ids[0] ?? null);
    setAnchorName(selected.name ?? "Unnamed");
    setAnchorX(selected.x);
    setAnchorY(selected.y);
    xRef.current?.setValue(Math.round(selected.x));
    yRef.current?.setValue(Math.round(selected.y));
  });

  const handlePositionChange = (axis: "x" | "y", value: number) => {
    if (!singleAnchorId) return;

    const layer = editor.glyphInstanceCell.peek()?.layer;
    if (!layer) return;

    const nextX = axis === "x" ? value : anchorX;
    const nextY = axis === "y" ? value : anchorY;
    layer.applyPositionPatch([{ kind: "anchor", id: singleAnchorId, x: nextX, y: nextY }]);
  };

  return (
    <SidebarSection title="Anchor">
      <div className="text-xs text-secondary">{anchorName ?? "No anchor selected"}</div>
      <div className="flex gap-2">
        <EditableSidebarInput
          ref={xRef}
          label="X"
          disabled={singleAnchorId === null || !hasLayer}
          onValueChange={(value) => handlePositionChange("x", value)}
        />
        <EditableSidebarInput
          ref={yRef}
          label="Y"
          disabled={singleAnchorId === null || !hasLayer}
          onValueChange={(value) => handlePositionChange("y", value)}
        />
      </div>
    </SidebarSection>
  );
};
