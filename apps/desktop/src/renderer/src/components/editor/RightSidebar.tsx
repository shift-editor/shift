import { useParams } from "react-router";
import { GlyphSidebar } from "@shift/editor/ui";
import { useSignalState } from "@shift/editor/signals";
import { isSegmentId } from "@shift/glyph-state";
import { asGlyphId, isAnchorId, isComponentId, isContourId, isPointId } from "@shift/types";
import { Button } from "@shift/ui";
import { BooleanOps } from "./BooleanOps";
import { AnchorSection } from "./sidebar-right/AnchorSection";
import { HandleSection } from "./sidebar-right/HandleSection";
import { ScaleSection } from "./sidebar-right/ScaleSection";
import { TransformSection } from "./sidebar-right/TransformSection";
import { ZoomMenu } from "./sidebar-right/ZoomMenu";
import { LockIcon } from "@/components/icons/LockIcon";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import { usePreviewNotice } from "@/context/PreviewNoticeProvider";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";

export const RightSidebar = () => {
  const session = useFontSession();
  const showPreviewNotice = usePreviewNotice();
  const readOnlyFont = session.mode === "preview";
  const editor = useEditor();
  const { glyphId: glyphIdParam } = useParams();
  const { availableGlyphs } = useGlyphCatalog();
  const glyphId = glyphIdParam ? asGlyphId(glyphIdParam) : null;
  const glyphLabel = glyphId
    ? availableGlyphs.find((candidate) => candidate.id === glyphId)?.displayName
    : undefined;
  const familyName = useSignalState(session.catalog.familyNameCell) ?? "Untitled";
  const selection = useSignalState(editor.selection.stateCell, { schedule: "frame" });

  const hasTransformSelection = selection.ids.some(
    (id) => isPointId(id) || isContourId(id) || isSegmentId(id) || isComponentId(id),
  );
  const hasAnchorSelection = selection.ids.some(isAnchorId);
  const hasBooleanSelection = selection.ids.filter(isContourId).length >= 2;

  return (
    <GlyphSidebar
      session={session}
      host={{
        glyphLabel,
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
            {hasTransformSelection || hasBooleanSelection ? (
              <div className="flex flex-col gap-4 px-3 py-3">
                <BooleanOps />
                {hasTransformSelection ? (
                  <>
                    <HandleSection />
                    <TransformSection />
                    <ScaleSection />
                  </>
                ) : null}
              </div>
            ) : null}
            {!hasTransformSelection && hasAnchorSelection ? (
              <div className="flex flex-col gap-4 px-3 py-3">
                <AnchorSection />
              </div>
            ) : null}
          </TransformOriginProvider>
        ),
      }}
    />
  );
};
