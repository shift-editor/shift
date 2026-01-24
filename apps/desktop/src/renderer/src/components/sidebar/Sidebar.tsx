import { Separator } from "@shift/ui";
import { TransformSection } from "./TransformSection";
import { ScaleSection } from "./ScaleSection";
import AppState, { getEditor } from "@/store/store";
import { useValue } from "@/lib/reactive";

export const Sidebar = () => {
  const fileName = AppState((state) => state.fileName);
  const editor = getEditor();
  const zoom = useValue(editor.zoom);
  const zoomPercent = Math.round(zoom * 100);

  return (
    <aside className="w-[250px] h-full bg-panel border-l border-line-subtle flex flex-col">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-ui font-medium text-primary truncate">
          {fileName ?? "Untitled"}
        </span>
        <span className="text-ui text-muted">{zoomPercent}%</span>
      </div>
      <Separator />
      <div className="px-3 py-3 flex flex-col gap-4">
        <TransformSection />
        <ScaleSection />
      </div>
    </aside>
  );
};
