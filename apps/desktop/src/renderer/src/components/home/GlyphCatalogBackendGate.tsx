import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SlugGlyphCatalogSurface } from "./SlugGlyphCatalogSurface";
import { SvgGlyphCatalogGrid } from "./SvgGlyphCatalogGrid";
import type { GlyphId, GlyphName } from "@shift/types";
import { effect, track } from "@/lib/signals";
import type { GlyphCatalogBackendGateProps, PendingGlyphNames } from "@/types/glyphCatalog";
import type { GlyphCatalogRendererKind } from "@/types/glyphCatalogRenderer";
import { useFontSession } from "@/workspace/WorkspaceContext";

/** Selects one session backend while keeping shared catalog and rename state in React. */
export function GlyphCatalogBackendGate({
  glyphs,
  location,
  metrics,
  sourceId,
  active,
  atlasSource,
  observeAtlasInvalidation,
  glyphPreviews,
  canAuthor,
  openGlyph,
  onFirstFrame,
  onUnavailable,
}: GlyphCatalogBackendGateProps) {
  const session = useFontSession();
  const workspace = session.workspace;
  const editsSettled =
    useSyncExternalStore(
      (callback) => {
        if (!workspace) return () => {};

        const subscription = effect(() => {
          track(workspace.applyStatusCell);
          callback();
        });
        return () => subscription.dispose();
      },
      () => workspace?.applyStatusCell.peek() ?? "idle",
    ) === "idle";
  const [backend, setBackend] = useState<"initializing" | GlyphCatalogRendererKind>("initializing");
  const [pendingGlyphNames, setPendingGlyphNames] = useState<PendingGlyphNames>(() => new Map());
  const displayGlyphs = useMemo(
    () =>
      glyphs.map((glyph) => {
        const pendingName = pendingGlyphNames.get(glyph.id);
        return pendingName ? { ...glyph, name: pendingName, displayName: pendingName } : glyph;
      }),
    [glyphs, pendingGlyphNames],
  );

  useEffect(() => {
    if (pendingGlyphNames.size === 0) return;

    setPendingGlyphNames((current) => {
      const next = new Map(current);

      for (const [glyphId, pendingName] of current) {
        const visibleGlyph = glyphs.find(({ id }) => id === glyphId);
        const committedName = session.font.recordForId(glyphId)?.name;
        const visibleNameConfirmed =
          committedName === pendingName && (!visibleGlyph || visibleGlyph.name === pendingName);
        const renameRejected = editsSettled && committedName !== pendingName;
        if (visibleNameConfirmed || renameRejected) next.delete(glyphId);
      }

      return next.size === current.size ? current : next;
    });
  }, [editsSettled, glyphs, pendingGlyphNames, session.font]);

  const handlePendingGlyphName = useCallback((glyphId: GlyphId, glyphName: GlyphName) => {
    setPendingGlyphNames((current) => new Map(current).set(glyphId, glyphName));
  }, []);
  const handleSlugSelected = useCallback(() => {
    setBackend((current) => (current === "initializing" ? "slug" : current));
  }, []);
  const handleSlugFallback = useCallback(() => {
    setBackend((current) => (current === "initializing" ? "svg" : current));
  }, []);

  if (backend === "svg") {
    return (
      <SvgGlyphCatalogGrid
        glyphs={displayGlyphs}
        location={location}
        metrics={metrics}
        active={active}
        observeAtlasInvalidation={observeAtlasInvalidation}
        glyphPreviews={glyphPreviews}
        canAuthor={canAuthor}
        openGlyph={openGlyph}
        onPendingGlyphName={handlePendingGlyphName}
        onFirstFrame={onFirstFrame}
        onUnavailable={onUnavailable}
      />
    );
  }

  return (
    <SlugGlyphCatalogSurface
      glyphs={displayGlyphs}
      location={location}
      metrics={metrics}
      sourceId={sourceId}
      active={active}
      atlasSource={atlasSource}
      observeAtlasInvalidation={observeAtlasInvalidation}
      canAuthor={canAuthor}
      openGlyph={openGlyph}
      onPendingGlyphName={handlePendingGlyphName}
      onSelected={handleSlugSelected}
      onFallback={handleSlugFallback}
      onFirstFrame={onFirstFrame}
      onUnavailable={onUnavailable}
    />
  );
}
