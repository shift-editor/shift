import { Button, Separator } from "@shift/ui";
import { isAnchorId, isContourId, isPointId } from "@shift/types";
import { isSegmentId } from "@shift/glyph-state";
import { TransformSection } from "./sidebar-right/TransformSection";
import { ScaleSection } from "./sidebar-right/ScaleSection";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@/lib/signals";
import { GlyphSection } from "./sidebar-right/GlyphSection";
import { AnchorSection } from "./sidebar-right/AnchorSection";
import { BooleanOps } from "./BooleanOps";
import { LockIcon } from "@/components/icons/LockIcon";
import { usePreviewNotice } from "@/context/PreviewNoticeProvider";

export const RightSidebar = () => {
  const session = useFontSession();
  const showPreviewNotice = usePreviewNotice();
  const readOnlyFont = session.mode === "preview";

  const editor = useEditor();

  const familyName = useSignalState(session.catalog.familyNameCell) ?? "Untitled";

  const zoom = useSignalState(editor.zoomCell);
  const selection = useSignalState(editor.selection.stateCell);

  const hasGeometrySelection = selection.ids.some(
    (id) => isPointId(id) || isContourId(id) || isSegmentId(id),
  );
  const hasAnchorSelection = selection.ids.some(isAnchorId);
  const hasBooleanSelection = selection.ids.filter(isContourId).length >= 2;

  return (
    <aside
      aria-label="Glyph properties"
      className="h-full w-full min-w-0 bg-panel border-l border-line-subtle flex flex-col overflow-hidden"
    >
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-ui font-medium text-primary truncate">{familyName}</span>
          {readOnlyFont && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Read-only preview"
              className="h-5 w-5 p-0 text-sidebar-icon"
              onClick={showPreviewNotice}
            >
              <LockIcon aria-hidden className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <span className="text-ui font-medium text-muted">{Math.round(zoom * 100)}%</span>
      </div>
      <Separator />
      <TransformOriginProvider>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-3 py-3">
            <GlyphSection />
          </div>
          <Separator />
          {(hasGeometrySelection || hasBooleanSelection) && (
            <div className="px-3 py-3 flex flex-col gap-4">
              <BooleanOps />
              {hasGeometrySelection && (
                <>
                  <TransformSection />
                  <ScaleSection />
                </>
              )}
            </div>
          )}
          {!hasGeometrySelection && hasAnchorSelection && (
            <div className="px-3 py-3 flex flex-col gap-4">
              <AnchorSection />
            </div>
          )}
        </div>
      </TransformOriginProvider>
    </aside>
  );
};
