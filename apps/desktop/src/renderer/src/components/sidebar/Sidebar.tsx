import { useState } from "react";
import { Separator } from "@shift/ui";
import { TransformSection } from "./TransformSection";
import { ScaleSection } from "./ScaleSection";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { GlyphSection } from "./GlyphSection";
import { AnchorSection } from "./AnchorSection";

export const Sidebar = () => {
  const editor = getEditor();
  const { familyName } = editor.font.getMetadata();
  const zoom = useSignalState(editor.zoom);
  const zoomPercent = Math.round(zoom * 100);

  const [hasPointSelection, setHasPointSelection] = useState(false);
  const [hasAnchorSelection, setHasAnchorSelection] = useState(false);

  useSignalEffect(() => {
    const pointIds = editor.selectedPointIds.value;
    const anchorIds = editor.selectedAnchorIds.value;
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
