import { Separator } from "@shift/ui";
import { TransformSection } from "./TransformSection";
import { ScaleSection } from "./ScaleSection";
import { AlignmentSection } from "./AlignmentSection";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import AppState, { getEditor } from "@/store/store";
import { useValue } from "@/lib/reactive";
import { GlyphSection } from "./GlyphSection";
import { useSelectionBounds } from "@/hooks/useSelectionBounds";

export const Sidebar = () => {
  const fileName = AppState((state) => state.fileName);
  const editor = getEditor();
  const zoom = useValue(editor.zoom);
  const zoomPercent = Math.round(zoom * 100);

  const { hasSelection } = useSelectionBounds();

  return (
    <aside className="w-[250px] h-full bg-panel border-l border-line-subtle flex flex-col">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-ui font-medium text-primary truncate">{fileName ?? "Untitled"}</span>
        <span className="text-ui font-medium text-muted">{zoomPercent}%</span>
      </div>
      <Separator />
      <TransformOriginProvider>
        <div className="px-3 py-3 flex flex-col gap-4">
          <GlyphSection />
          {hasSelection && (
            <>
              <Separator />
              <TransformSection />
              <ScaleSection />
              <Separator />
              <AlignmentSection />
            </>
          )}
        </div>
        <Separator />
      </TransformOriginProvider>
    </aside>
  );
};
