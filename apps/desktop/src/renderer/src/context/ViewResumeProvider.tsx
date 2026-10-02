import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSignalState } from "@shift/editor/signals";
import { getShiftHost } from "@/host/shiftHost";
import { matchResumeGlyph } from "@/lib/workspace/resumeGlyph";
import { viewResumeRestoreActive } from "@/lib/workspace/viewResumeRestoreActive";
import { useFont } from "@/workspace/WorkspaceContext";
import { useGlyphCatalog } from "./GlyphCatalogContext";
import { useViewResumeCapture } from "./ViewResumeCaptureContext";
import { glyphIdFromPath } from "./glyphCatalogRoute";
type ViewResumeProviderProps = {
  children: ReactNode;
  onRestoredScrollTop: (scrollTop: number) => void;
};

/** Restores persisted catalog and editor routes after a session transition. */
export function ViewResumeProvider({ children, onRestoredScrollTop }: ViewResumeProviderProps) {
  const font = useFont();
  const catalog = useGlyphCatalog();
  const { notifyConsumed } = useViewResumeCapture();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const documentLoaded = useSignalState(font.loadedCell);
  const availableGlyphs = catalog.availableGlyphs;
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!documentLoaded) return;
    if (!viewResumeRestoreActive()) return;
    if (restoredRef.current) return;

    let active = true;

    async function restore(): Promise<void> {
      try {
        const resume = await getShiftHost().session.peekViewResume();
        if (!active) return;
        if (!resume) {
          restoredRef.current = true;
          notifyConsumed();
          return;
        }

        catalog.restoreCatalogView(resume.catalog);
        onRestoredScrollTop(resume.catalog.scrollTop);

        if (resume.route && availableGlyphs.length === 0) return;

        const remapped =
          resume.route && availableGlyphs.length > 0
            ? matchResumeGlyph(availableGlyphs, resume.route)
            : null;

        if (remapped) {
          const routeGlyphId = glyphIdFromPath(routeLocation.pathname);
          if (routeGlyphId !== remapped) {
            navigate(`/editor/${encodeURIComponent(remapped)}`, { replace: true });
            return;
          }

          if (!availableGlyphs.some((glyph) => glyph.id === remapped)) return;
        }
        await getShiftHost().session.consumeViewResume();
        restoredRef.current = true;
        notifyConsumed();
      } catch (error) {
        console.error("view resume restore failed", error);
      }
    }

    void restore();

    return () => {
      active = false;
    };
  }, [
    availableGlyphs,
    catalog,
    documentLoaded,
    navigate,
    notifyConsumed,
    onRestoredScrollTop,
    routeLocation.pathname,
  ]);

  return children;
}
