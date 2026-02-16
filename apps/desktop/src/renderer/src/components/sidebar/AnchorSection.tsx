import { useRef } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { getEditor } from "@/store/store";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { useState } from "react";
import type { AnchorId } from "@shift/types";

export const AnchorSection = () => {
  const editor = getEditor();
  const [singleAnchorId, setSingleAnchorId] = useState<AnchorId | null>(null);
  const [anchorName, setAnchorName] = useState<string | null>(null);
  const [anchorX, setAnchorX] = useState(0);
  const [anchorY, setAnchorY] = useState(0);
  const xRef = useRef<EditableSidebarInputHandle>(null);
  const yRef = useRef<EditableSidebarInputHandle>(null);

  useSignalEffect(() => {
    const glyph = editor.glyph.value;
    const ids = [...editor.selectedAnchorIds.value];

    if (!glyph || ids.length !== 1) {
      setSingleAnchorId(null);
      setAnchorName(ids.length > 1 ? "Multiple" : null);
      setAnchorX(0);
      setAnchorY(0);
      xRef.current?.setValue(0);
      yRef.current?.setValue(0);
      return;
    }

    const selected = glyph.anchors.find((anchor) => anchor.id === ids[0]) ?? null;
    setSingleAnchorId(ids[0] ?? null);
    setAnchorName(selected?.name ?? "Unnamed");
    setAnchorX(selected?.x ?? 0);
    setAnchorY(selected?.y ?? 0);
    xRef.current?.setValue(Math.round(selected?.x ?? 0));
    yRef.current?.setValue(Math.round(selected?.y ?? 0));
  });

  const handlePositionChange = (axis: "x" | "y", value: number) => {
    if (!singleAnchorId) return;
    const nextX = axis === "x" ? value : anchorX;
    const nextY = axis === "y" ? value : anchorY;
    editor.setAnchorPositions([{ id: singleAnchorId, x: nextX, y: nextY }]);
    editor.requestRedraw();
  };

  return (
    <SidebarSection title="Anchor">
      <div className="text-xs text-secondary">{anchorName ?? "No anchor selected"}</div>
      <div className="flex gap-2">
        <EditableSidebarInput
          ref={xRef}
          label="X"
          disabled={singleAnchorId === null}
          onValueChange={(value) => handlePositionChange("x", value)}
        />
        <EditableSidebarInput
          ref={yRef}
          label="Y"
          disabled={singleAnchorId === null}
          onValueChange={(value) => handlePositionChange("y", value)}
        />
      </div>
    </SidebarSection>
  );
};
