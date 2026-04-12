import { useState } from "react";
import { Separator } from "@shift/ui";
import { TransformSection } from "./sidebar-right/TransformSection";
import { ScaleSection } from "./sidebar-right/ScaleSection";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { GlyphSection } from "./sidebar-right/GlyphSection";
import { AnchorSection } from "./sidebar-right/AnchorSection";
import { BooleanOps } from "./BooleanOps";

export const GlyphSidebar = () => {
  const editor = getEditor();
  const { familyName } = editor.font.getMetadata();
  const zoom = useSignalState(editor.zoom);
  const zoomPercent = Math.round(zoom * 100);

  const [hasPointSelection, setHasPointSelection] = useState(false);
  const [hasAnchorSelection, setHasAnchorSelection] = useState(false);

  useSignalEffect(() => {
    const pointIds = editor.selection.$pointIds.value;
    const anchorIds = editor.selection.$anchorIds.value;
    const nextPoints = pointIds.size > 0;
    const nextAnchors = anchorIds.size > 0;
    setHasPointSelection((prev) => (prev === nextPoints ? prev : nextPoints));
    setHasAnchorSelection((prev) => (prev === nextAnchors ? prev : nextAnchors));
  });

  return (
    <aside className="w-[250px] h-full bg-panel border-l border-line-subtle flex flex-col">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-ui font-medium text-primary truncate">
          {familyName ?? "Untitled"}
        </span>
        <span className="text-ui font-medium text-muted">{zoomPercent}%</span>
      </div>
      <Separator />
      <TransformOriginProvider>
        <div className="px-3 py-3">
          <GlyphSection />
        </div>
        <Separator />
        {hasPointSelection && (
          <div className="px-3 py-3 flex flex-col gap-4">
            <BooleanOps />
            <TransformSection />
            <ScaleSection />
          </div>
        )}
        {!hasPointSelection && hasAnchorSelection && (
          <div className="px-3 py-3 flex flex-col gap-4">
            <AnchorSection />
          </div>
        )}
      </TransformOriginProvider>
    </aside>
  );
};
