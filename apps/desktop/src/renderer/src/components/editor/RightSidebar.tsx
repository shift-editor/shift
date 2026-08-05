import { Separator } from "@shift/ui";
import { isAnchorId, isPointId } from "@shift/types";
import { TransformSection } from "./sidebar-right/TransformSection";
import { ScaleSection } from "./sidebar-right/ScaleSection";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";
import { GlyphSection } from "./sidebar-right/GlyphSection";
import { AnchorSection } from "./sidebar-right/AnchorSection";
import { BooleanOps } from "./BooleanOps";

export const RightSidebar = () => {
  const session = useFontSession();
  const familyName = useSignalState(session.catalog.familyNameCell) ?? "Untitled";

  return (
    <aside className="h-full w-full min-w-0 bg-panel border-l border-line-subtle flex flex-col overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-ui font-medium text-primary truncate">{familyName}</span>
        <AuthoredZoom />
      </div>
      <Separator />
      <AuthoredSections />
    </aside>
  );
};

const AuthoredZoom = () => {
  const editor = useEditor();
  const zoom = useSignalState(editor.zoomCell);

  return <span className="text-ui font-medium text-muted">{Math.round(zoom * 100)}%</span>;
};

const AuthoredSections = () => {
  const editor = useEditor();
  const selection = useSignalState(editor.selection.stateCell);
  const hasPointSelection = selection.ids.some(isPointId);
  const hasAnchorSelection = selection.ids.some(isAnchorId);

  return (
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
  );
};
