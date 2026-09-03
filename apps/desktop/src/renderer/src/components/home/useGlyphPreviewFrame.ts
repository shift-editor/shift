import { useEffect, useRef, useState } from "react";
import type { GlyphId } from "@shift/types";
import { GlyphPreviewCache } from "@/lib/catalog/GlyphPreviewCache";
import type {
  CatalogLocation,
  GlyphCatalogFrame,
  GlyphCatalogSource,
  GridReadiness,
} from "@/types/glyphCatalog";
import type { GlyphPreviewValue } from "@/types/glyphPreview";

const PREVIEW_BUDGET_BYTES = 256 * 1024 * 1024;
const PREVIEW_BATCH_SIZE = 256;

/**
 * Publishes complete visible SVG preview frames from a bounded session cache.
 *
 * @remarks
 * The previous publication remains stable while a new visible window resolves.
 * Obsolete location, scroll, and invalidation requests cannot publish.
 *
 * @param frame - Latest visible catalog window requested by layout.
 * @param location - Dense coordinates used to resolve every preview in the frame.
 * @param active - Whether the catalog route may acquire and publish previews.
 * @param glyphPreviews - Session boundary for batched SVG path acquisition.
 * @param observeAtlasInvalidation - Subscription for geometry and directory revisions.
 * @param onFirstFrame - Called once after the first complete publication.
 * @param onUnavailable - Called when the selected SVG backend cannot publish.
 * @returns The complete frame, its previews, readiness, and estimated cache bytes.
 */
export function useGlyphPreviewFrame(
  frame: GlyphCatalogFrame,
  location: CatalogLocation,
  active: boolean,
  glyphPreviews: GlyphCatalogSource["glyphPreviews"],
  observeAtlasInvalidation: GlyphCatalogSource["observeAtlasInvalidation"],
  onFirstFrame: () => void,
  onUnavailable: () => void,
): readonly [
  GlyphCatalogFrame | null,
  ReadonlyMap<GlyphId, GlyphPreviewValue | null>,
  GridReadiness,
  number,
] {
  const [cache] = useState(() => new GlyphPreviewCache(PREVIEW_BUDGET_BYTES));
  const [invalidationRevision, setInvalidationRevision] = useState(0);
  const [publication, setPublication] = useState<
    readonly [GlyphCatalogFrame | null, ReadonlyMap<GlyphId, GlyphPreviewValue | null>]
  >([null, new Map()]);
  const [readiness, setReadiness] = useState<GridReadiness>("Initial");
  const firstFramePublishedRef = useRef(false);
  const requestRevisionRef = useRef(0);
  const locationKey = location.join("|");

  useEffect(
    () =>
      observeAtlasInvalidation((glyphIds) => {
        requestRevisionRef.current += 1;
        cache.invalidate(glyphIds);
        setReadiness(firstFramePublishedRef.current ? "Stale" : "Initial");
        setInvalidationRevision((revision) => revision + 1);
      }),
    [cache, observeAtlasInvalidation],
  );

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    const requestRevision = requestRevisionRef.current + 1;
    requestRevisionRef.current = requestRevision;

    function isObsolete(): boolean {
      return cancelled || requestRevision !== requestRevisionRef.current;
    }

    async function publish(): Promise<void> {
      try {
        cache.rekey(locationKey);
        const glyphIds = frame.cells.map((cell) => cell.glyph.id);
        const missingGlyphIds = glyphIds.filter((glyphId) => !cache.has(glyphId));
        if (missingGlyphIds.length > 0) {
          setReadiness(firstFramePublishedRef.current ? "Stale" : "Initial");
        }

        for (let start = 0; start < missingGlyphIds.length; start += PREVIEW_BATCH_SIZE) {
          const batch = missingGlyphIds.slice(start, start + PREVIEW_BATCH_SIZE);
          const previews = await glyphPreviews(batch, location);
          if (cache.key !== locationKey) return;

          cache.fill(batch, previews);
          if (isObsolete()) return;
        }

        if (isObsolete()) return;
        if (glyphIds.some((glyphId) => !cache.has(glyphId))) {
          throw new Error("SVG preview frame exceeds the configured cache budget");
        }

        const previews = new Map<GlyphId, GlyphPreviewValue | null>();
        for (const glyphId of glyphIds) {
          previews.set(glyphId, cache.get(glyphId) ?? null);
        }

        setPublication([frame, previews]);
        setReadiness("Complete");
        if (!firstFramePublishedRef.current) {
          firstFramePublishedRef.current = true;
          onFirstFrame();
        }
      } catch (error) {
        if (isObsolete()) return;

        console.error("SVG glyph catalog refresh failed", error);
        setReadiness("Unavailable");
        onUnavailable();
      }
    }

    void publish();
    return () => {
      cancelled = true;
    };
  }, [
    active,
    cache,
    frame,
    glyphPreviews,
    invalidationRevision,
    location,
    locationKey,
    onFirstFrame,
    onUnavailable,
  ]);

  return [publication[0], publication[1], readiness, cache.bytes];
}
