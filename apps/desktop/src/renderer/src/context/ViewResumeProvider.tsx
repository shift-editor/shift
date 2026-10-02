import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSignalState } from "@shift/editor/signals";
import { getShiftHost } from "@/host/shiftHost";
import { matchResumeGlyph } from "@/lib/workspace/resumeGlyph";
import { viewResumeRestoreActive } from "@/lib/workspace/viewResumeRestoreActive";
import { useFont, useFontSession } from "@/workspace/WorkspaceContext";
import { useGlyphCatalog } from "./GlyphCatalogContext";
import { glyphIdFromPath } from "./glyphCatalogRoute";

type ViewResumeProviderProps = {
  children: ReactNode;
  onRestoredScrollTop: (scrollTop: number) => void;
};

/** Restores persisted catalog and editor routes after a session transition. */
export function ViewResumeProvider({ children, onRestoredScrollTop }: ViewResumeProviderProps) {
  const session = useFontSession();
  const font = useFont();
  const catalog = useGlyphCatalog();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const documentLoaded = useSignalState(font.loadedCell);

  useEffect(() => {
    if (!documentLoaded) return;
    if (!viewResumeRestoreActive()) return;

    let active = true;

    async function restore(): Promise<void> {
      try {
        const resume = await getShiftHost().session.takeViewResume();
        if (!active || !resume) return;

        catalog.restoreCatalogView(resume.catalog);
        onRestoredScrollTop(resume.catalog.scrollTop);

        const remapped = resume.route
          ? matchResumeGlyph(catalog.availableGlyphs, resume.route)
          : null;

        if (remapped) {
          const glyph = catalog.availableGlyphs.find((item) => item.id === remapped);
          if (glyph) {
            await catalog.openGlyph(glyph);
            navigate(`/editor/${encodeURIComponent(remapped)}`, { replace: true });
            return;
          }
        }

        const routeGlyphId = glyphIdFromPath(routeLocation.pathname);
        if (routeGlyphId !== null) {
          const glyph = catalog.availableGlyphs.find((item) => item.id === routeGlyphId);
          if (glyph) await catalog.openGlyph(glyph);
        }
      } catch (error) {
        console.error("view resume restore failed", error);
      }
    }

    void restore();

    return () => {
      active = false;
    };
  }, [
    catalog,
    documentLoaded,
    navigate,
    onRestoredScrollTop,
    routeLocation.pathname,
    session.mode,
  ]);

  return children;
}
