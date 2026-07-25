import { useEffect, useMemo, useRef, useState } from "react";
import type { GlyphId } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";
import { GlyphPreviewCache } from "@/lib/model/GlyphPreviewCache";
import { computed, useSignalState, type Signal } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { AxisLocation } from "@/types/variation";
import { nextWarmupChunk } from "./glyphGridWarmup";
import type { GlyphGridPreview } from "./GlyphPreview";

export interface GlyphGridFrame {
  readonly location: AxisLocation;
  readonly previews: ReadonlyMap<GlyphId, GlyphGridPreview>;
}

function axisLocationKey(location: AxisLocation): string {
  return [...location.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([axisId, value]) => `${axisId}:${value}`)
    .join("|");
}

export interface GlyphGridOptions {
  readonly glyphIds: readonly GlyphId[];
  /** Preview read-ahead band beyond the rendered window; never awaited. */
  readonly prefetchGlyphIds?: readonly GlyphId[];
  /**
   * Whole-catalog preview warm-up processed only while the lane is otherwise
   * idle. Full preview residency is what makes scrollbar scrubbing stream
   * like local content instead of stepping between fetched windows.
   */
  readonly warmupGlyphIds?: readonly GlyphId[];
  /** Catalog index of the first rendered glyph; anchors outward warm-up. */
  readonly warmupCenterIndex?: number;
  readonly location: Signal<AxisLocation>;
}

/** Window must hold still this long before live models load for it. */
const SETTLE_MS = 120;
/** Idle warm-up previews fetched per request. */
const WARMUP_CHUNK = 400;
/** Byte budget for resident previews (~full 65k CJK font at one location). */
const PREVIEW_BUDGET_BYTES = 256 * 1024 * 1024;

export function createGlyphGridFrameCell(
  glyphs: readonly Glyph[],
  fallbackPreviews: ReadonlyMap<GlyphId, GlyphGridPreview>,
  location: Signal<AxisLocation>,
): Signal<GlyphGridFrame> {
  return computed(
    () => {
      const currentLocation = location.value;
      const previews = new Map<GlyphId, GlyphGridPreview>();

      for (const glyph of glyphs) {
        const renderModel = glyph.renderModelAt(location);
        previews.set(glyph.id, {
          svgPath: renderModel.svgPathCell.value,
          xAdvance: renderModel.xAdvanceCell.value,
        });
      }

      // Bridge-printed previews mask load latency for cells without a live
      // model yet; a resident model always wins.
      for (const [glyphId, preview] of fallbackPreviews) {
        if (!previews.has(glyphId)) previews.set(glyphId, preview);
      }

      return { location: currentLocation, previews };
    },
    { name: "glyphGrid.frame" },
  );
}

export function useGlyphGridFrame({
  glyphIds,
  prefetchGlyphIds,
  warmupGlyphIds,
  warmupCenterIndex,
  location,
}: GlyphGridOptions): GlyphGridFrame {
  const editor = useEditor();
  const font = editor.font;
  const [glyphs, setGlyphs] = useState<readonly Glyph[]>([]);
  const [prefetched, setPrefetched] = useState<{ key: string; version: number }>({
    key: "",
    version: 0,
  });
  const latestGlyphIdsRef = useRef<readonly GlyphId[]>(glyphIds);
  const prefetchGlyphIdsRef = useRef<readonly GlyphId[]>(prefetchGlyphIds ?? []);
  const warmupGlyphIdsRef = useRef<readonly GlyphId[]>(warmupGlyphIds ?? []);
  const warmupCenterIndexRef = useRef(warmupCenterIndex ?? 0);
  const previewCacheRef = useRef<GlyphPreviewCache | null>(null);
  const previewLoadingRef = useRef(false);
  const modelLoadingRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  prefetchGlyphIdsRef.current = prefetchGlyphIds ?? [];
  warmupGlyphIdsRef.current = warmupGlyphIds ?? [];
  warmupCenterIndexRef.current = warmupCenterIndex ?? 0;
  previewCacheRef.current ??= new GlyphPreviewCache(PREVIEW_BUDGET_BYTES);
  const previewCache = previewCacheRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  // Two lanes. While scrolling, only cheap bridge-printed previews are
  // fetched (latest-window-wins), so the utility never stalls behind heavy
  // snapshot reads. Live models load once the window has held still for
  // SETTLE_MS; windows scrolled past never load models at all.
  useEffect(() => {
    latestGlyphIdsRef.current = glyphIds;

    async function loadLatestPreviews(): Promise<void> {
      if (previewLoadingRef.current) return;
      previewLoadingRef.current = true;
      try {
        for (;;) {
          const requested = latestGlyphIdsRef.current;
          const locationValue = location.peek();
          const key = axisLocationKey(locationValue);
          previewCache.rekey(key);

          const isCovered = (glyphId: GlyphId): boolean =>
            previewCache.has(glyphId) || editor.glyphForId(glyphId) !== null;
          let wanted = [...requested, ...prefetchGlyphIdsRef.current].filter(
            (glyphId) => !isCovered(glyphId),
          );

          // The live band always wins; outward warm-up fills idle gaps until
          // the catalog is covered or the byte budget says stop churning.
          if (wanted.length === 0 && !previewCache.nearBudget()) {
            wanted = nextWarmupChunk(
              warmupGlyphIdsRef.current,
              warmupCenterIndexRef.current,
              isCovered,
              WARMUP_CHUNK,
            );
          }

          if (wanted.length > 0) {
            const results = await font.glyphPreviews(wanted, locationValue);
            if (!mountedRef.current) return;
            if (previewCache.key === key && results.length > 0) {
              previewCache.fill(results);
              setPrefetched({ key, version: previewCache.version });
            }
            continue;
          }

          if (latestGlyphIdsRef.current === requested) return;
        }
      } catch (error) {
        console.error("[glyph-previews] load failed", { error });
      } finally {
        previewLoadingRef.current = false;
      }
    }

    async function loadSettledWindow(): Promise<void> {
      if (modelLoadingRef.current) {
        scheduleSettledLoad();
        return;
      }

      modelLoadingRef.current = true;
      try {
        const requested = latestGlyphIdsRef.current;
        const loadedGlyphs = await font.loadGlyphs(requested);

        if (latestGlyphIdsRef.current !== requested) {
          scheduleSettledLoad();
          return;
        }
        if (mountedRef.current) setGlyphs(loadedGlyphs);
      } catch (error) {
        console.error("[glyph-grid] load failed", { error });
      } finally {
        modelLoadingRef.current = false;
      }
    }

    function scheduleSettledLoad(): void {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        void loadSettledWindow();
      }, SETTLE_MS);
    }

    void loadLatestPreviews();
    scheduleSettledLoad();
  }, [editor, font, glyphIds, location]);

  // Resolve rendered ids to resident models so rows entering the window paint
  // as soon as their glyphs are in the store; ids without a model fall back to
  // bridge-printed previews until their load lands (`glyphs` is the arrival
  // trigger). The initial workspace reveal still waits for a complete frame
  // via the grid's first-frame gate.
  const frameCell = useMemo(() => {
    const resident: Glyph[] = [];
    const fallbackPreviews = new Map<GlyphId, GlyphGridPreview>();
    for (const glyphId of glyphIds) {
      const glyph = editor.glyphForId(glyphId);
      if (glyph) {
        resident.push(glyph);
        continue;
      }

      // Cache reads touch recency: rendered cells are the last to evict.
      const preview = previewCache.get(glyphId);
      if (preview) fallbackPreviews.set(glyphId, preview);
    }
    return createGlyphGridFrameCell(resident, fallbackPreviews, location);
  }, [editor, glyphIds, glyphs, location, prefetched, previewCache]);

  return useSignalState(frameCell, { schedule: "frame" });
}
