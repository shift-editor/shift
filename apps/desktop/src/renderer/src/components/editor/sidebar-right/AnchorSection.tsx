import { useRef } from "react";
import { SidebarSection } from "./SidebarSection";
import { EditableSidebarInput, type EditableSidebarInputHandle } from "./EditableSidebarInput";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { useState } from "react";
import type { AnchorId } from "@shift/types";

export const AnchorSection = () => {
  const [singleAnchorId, setSingleAnchorId] = useState<AnchorId | null>(null);

  const [anchorName, setAnchorName] = useState<string | null>(null);
  const [hasLayer, setHasLayer] = useState(false);

  const xRef = useRef<EditableSidebarInputHandle>(null);
  const yRef = useRef<EditableSidebarInputHandle>(null);

  useSignalEffect(() => {
    setHasLayer(false);
    setSingleAnchorId(null);
    setAnchorName(null);
    xRef.current?.setValue(0);
    yRef.current?.setValue(0);
  });

  const handlePositionChange = (axis: "x" | "y", value: number) => {
    void axis;
    void value;
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
