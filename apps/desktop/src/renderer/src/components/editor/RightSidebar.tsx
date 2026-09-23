import { GlyphSidebar } from "@shift/editor/ui";
import { useSignalState } from "@shift/editor/signals";
import { isSegmentId } from "@shift/glyph-state";
import { isAnchorId, isContourId, isPointId } from "@shift/types";
import { Button, Separator } from "@shift/ui";
import { BooleanOps } from "./BooleanOps";
import { AnchorSection } from "./sidebar-right/AnchorSection";
import { HandleSection } from "./sidebar-right/HandleSection";
import { ScaleSection } from "./sidebar-right/ScaleSection";
import { TransformSection } from "./sidebar-right/TransformSection";
import { ZoomMenu } from "./sidebar-right/ZoomMenu";
import { LockIcon } from "@/components/icons/LockIcon";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import { usePreviewNotice } from "@/context/PreviewNoticeProvider";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";

export const RightSidebar = () => {
  const session = useFontSession();
  const showPreviewNotice = usePreviewNotice();
  const readOnlyFont = session.mode === "preview";
  const editor = useEditor();
  const familyName = useSignalState(session.catalog.familyNameCell) ?? "Untitled";
  const selection = useSignalState(editor.selection.stateCell);

  const hasGeometrySelection = selection.ids.some(
    (id) => isPointId(id) || isContourId(id) || isSegmentId(id),
  );
  const hasAnchorSelection = selection.ids.some(isAnchorId);
  const hasBooleanSelection = selection.ids.filter(isContourId).length >= 2;

  return (
    <GlyphSidebar
      session={session}
      host={{
        header: (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-ui font-medium text-primary">{familyName}</span>
              {readOnlyFont ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Read-only preview"
                  className="h-5 w-5 p-0 text-sidebar-icon"
                  onClick={showPreviewNotice}
                >
                  <LockIcon aria-hidden className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
            <ZoomMenu />
          </>
        ),
        selection: (
          <TransformOriginProvider>
            {hasGeometrySelection || hasBooleanSelection ? (
              <>
                <Separator />
                <div className="flex flex-col gap-4 px-3 py-3">
                  <BooleanOps />
                  {hasGeometrySelection ? (
                    <>
                      <HandleSection />
                      <TransformSection />
                      <ScaleSection />
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
            {!hasGeometrySelection && hasAnchorSelection ? (
              <>
                <Separator />
                <div className="flex flex-col gap-4 px-3 py-3">
                  <AnchorSection />
                </div>
              </>
            ) : null}
          </TransformOriginProvider>
        ),
      }}
    />
  );
};
