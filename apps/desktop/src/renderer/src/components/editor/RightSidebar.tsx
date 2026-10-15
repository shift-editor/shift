import { GlyphSidebar } from "@shift/editor/ui";
import { useSignalState } from "@shift/editor/signals";
import { isSegmentId } from "@shift/glyph-state";
import { isAnchorId, isComponentId, isContourId, isPointId, type GlyphId } from "@shift/types";
import { Button } from "@shift/ui";
import { BooleanOps } from "./BooleanOps";
import { AnchorSection } from "./sidebar-right/AnchorSection";
import { FeaturesSection } from "./sidebar-right/FeaturesSection";
import { GlyphKerningGroups } from "./sidebar-right/GlyphKerningGroups";
import { HandleSection } from "./sidebar-right/HandleSection";
import { KerningPairSection } from "./sidebar-right/KerningPairSection";
import { ScaleSection } from "./sidebar-right/ScaleSection";
import { TextSection } from "./sidebar-right/TextSection";
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
  // Read the catalog's glyph list directly: the catalog context changes on every scrub step.
  const availableGlyphs = useSignalState(session.catalog.glyphsCell);
  const glyphLabel = (glyphId: GlyphId) =>
    availableGlyphs.find((candidate) => candidate.id === glyphId)?.displayName;
  const familyName = useSignalState(session.catalog.familyNameCell) ?? "Untitled";
  const selection = useSignalState(editor.selection.stateCell, { schedule: "frame" });
  const kerningActive = useSignalState(editor.toolIdCell) === "kerning";

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
        glyph: <GlyphKerningGroups />,
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
        selection: kerningActive ? (
          <KerningPairSection />
        ) : (
          <TransformOriginProvider>
            {/* Handle | Transform | Anchor | Text | Features: the selection, then its text. */}
            <div className="flex flex-col">
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
              {!hasTransformSelection && hasAnchorSelection ? (
                <SidebarGroup>
                  <AnchorSection />
                </SidebarGroup>
              ) : null}
              <SidebarGroup>
                <TextSection />
              </SidebarGroup>
              <SidebarGroup>
                <FeaturesSection />
              </SidebarGroup>
            </div>
          </TransformOriginProvider>
        ),
      }}
    />
  );
};

/**
 * One group of the selection's sections. An empty group, whose section has
 * nothing to show, is hidden; each shown group has a divider below it.
 */
const SidebarGroup = ({ children }: { readonly children: React.ReactNode }) => (
  <div
    data-sidebar-group=""
    className="flex flex-col gap-4 border-b border-line-subtle px-3 py-3 empty:hidden"
  >
    {children}
  </div>
);
