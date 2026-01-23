import { Divider } from "@shift/ui";
import { TransformSection } from "./TransformSection";
import { ScaleSection } from "./ScaleSection";
import AppState, { getEditor } from "@/store/store";

export const Sidebar = () => {
  const fileName = AppState((state) => state.fileName);
  const editor = getEditor();
  const zoomPercent = Math.round(editor.zoom() * 100);

  return (
    <aside className="w-[185px] h-full bg-panel border-l border-line-subtle flex flex-col">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-[9px] font-medium text-primary truncate">
          {fileName ?? "Untitled"}
        </span>
        <span className="text-[9px] text-muted">{zoomPercent}%</span>
      </div>
      <Divider />
      <div className="px-3 py-3 flex flex-col gap-4">
        <TransformSection />
        <ScaleSection />
      </div>
    </aside>
  );
};
