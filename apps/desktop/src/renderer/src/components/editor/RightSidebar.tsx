import { GlyphSidebar } from "@shift/editor/ui";
import { useSignalState } from "@shift/editor/signals";
import { isSegmentId } from "@shift/glyph-state";
import { isAnchorId, isComponentId, isContourId, isPointId } from "@shift/types";
import { useRef } from "react";
import { useLocation } from "react-router";
import { Button } from "@shift/ui";
import { BooleanOps } from "./BooleanOps";
import { AnchorSection } from "./sidebar-right/AnchorSection";
import { ExportSection } from "@/components/export/ExportSection";
import { FeaturesSection } from "./sidebar-right/FeaturesSection";
import { GlyphKerningSection } from "./sidebar-right/GlyphKerningSection";
import { GlyphTagButton } from "./sidebar-right/GlyphTag";
import { HandleSection } from "./sidebar-right/HandleSection";
import { KerningPairSection } from "./sidebar-right/KerningPairSection";
import { ScaleSection } from "./sidebar-right/ScaleSection";
import { StrokeSection } from "./sidebar-right/StrokeSection";
import { SidebarGroup } from "./sidebar-right/SidebarGroup";
import { TextSection } from "./sidebar-right/TextSection";
import { TransformSection } from "./sidebar-right/TransformSection";
import { ZoomMenu } from "./sidebar-right/ZoomMenu";
import { LockIcon } from "@/components/icons/LockIcon";
import { TransformOriginProvider } from "@/context/TransformOriginContext";
import { usePreviewNotice } from "@/context/PreviewNoticeProvider";
import { tagTargetsOf } from "@/lib/glyph-grid/tagTargets";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";

export const RightSidebar = () => {
  const session = useFontSession();
  const showPreviewNotice = usePreviewNotice();
  const readOnlyFont = session.mode === "preview";
  const editor = useEditor();
  const selection = useSignalState(editor.selection.stateCell, { schedule: "frame" });
  const toolId = useSignalState(editor.toolIdCell);
  const kerningActive = toolId === "kerning";
  // Text settings only while typing: other tools leave the run as it is.
  const textActive = toolId === "text";

  // The Text tool shows text settings instead: outline sections wait for another tool.
  const hasTransformSelection =
    !textActive &&
    selection.ids.some(
      (id) => isPointId(id) || isContourId(id) || isSegmentId(id) || isComponentId(id),
    );
  const selectionBlockRef = useRef<HTMLDivElement>(null);
  // Several glyphs selected in the grid: the sidebar shows one of them, so its title says so.
  const { pathname } = useLocation();
  const gridSelection = useSignalState(session.tabs.gridSelectionCell);
  const severalGlyphs = tagTargetsOf(pathname, gridSelection.ids, null).length > 1;
  const hasAnchorSelection = selection.ids.some(isAnchorId);
  const hasBooleanSelection = !textActive && selection.ids.filter(isContourId).length >= 2;

  return (
    <GlyphSidebar
      session={session}
      host={{
        title: severalGlyphs ? "Mixed" : undefined,
        headerActions: (
          <div className="flex shrink-0 items-center gap-1">
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
            <ZoomMenu />
          </div>
        ),
        glyphHeading: <GlyphTagButton />,
        selection: (
          <>
            {kerningActive ? (
              <KerningPairSection />
            ) : (
              <TransformOriginProvider>
                {/* Kerning | Handle | Transform | Stroke | Anchor | Text | Features, each a group with a divider between. */}
                <div ref={selectionBlockRef} className="flex flex-col">
                  <SidebarGroup>
                    <GlyphKerningSection anchorRef={selectionBlockRef} />
                  </SidebarGroup>
                  {hasTransformSelection ? (
                    <SidebarGroup>
                      <HandleSection />
                    </SidebarGroup>
                  ) : null}
                  {hasBooleanSelection || hasTransformSelection ? (
                    <SidebarGroup>
                      <BooleanOps />
                      {hasTransformSelection ? (
                        <>
                          <TransformSection />
                          <ScaleSection />
                        </>
                      ) : null}
                    </SidebarGroup>
                  ) : null}
                  {textActive ? null : (
                    <SidebarGroup>
                      <StrokeSection />
                    </SidebarGroup>
                  )}
                  {!hasTransformSelection && hasAnchorSelection ? (
                    <SidebarGroup>
                      <AnchorSection />
                    </SidebarGroup>
                  ) : null}
                  {textActive ? (
                    <SidebarGroup>
                      <TextSection />
                    </SidebarGroup>
                  ) : null}
                  <SidebarGroup>
                    <FeaturesSection />
                  </SidebarGroup>
                </div>
              </TransformOriginProvider>
            )}
            {/* Export, always: its panels open to the left, away from the window's edge. */}
            <div className="border-t border-line-subtle px-3 py-3">
              <ExportSection />
            </div>
          </>
        ),
      }}
    />
  );
};
