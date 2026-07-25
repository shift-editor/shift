import { memo } from "react";
import type { GlyphId, SourceMetrics } from "@shift/types";
import type { GlyphCatalogItem } from "@/context/GlyphCatalogContext";
import { Button } from "@shift/ui";
import { CELL_HEIGHT, GlyphPreview, type GlyphGridPreview } from "./GlyphPreview";
import { GlyphNameInput } from "./GlyphNameInput";
import type { GlyphGridRow as Row } from "./useGlyphGridVirtualization";

interface GlyphGridRowProps {
  readonly row: Row;
  readonly cellWidth: number;
  readonly previews: ReadonlyMap<GlyphId, GlyphGridPreview>;
  readonly metrics: SourceMetrics;
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
}

/**
 * Skips re-rendering a row unless something it draws actually changed.
 *
 * @remarks
 * The frame rebuilds its previews map identity on every scroll tick, so map
 * identity means nothing here; instead each of the row's cells is compared by
 * content. Preview `svgPath` strings come from cached render-model cells, so
 * unchanged cells compare by string reference in O(1).
 */
function rowPropsEqual(prev: GlyphGridRowProps, next: GlyphGridRowProps): boolean {
  if (
    prev.cellWidth !== next.cellWidth ||
    prev.metrics !== next.metrics ||
    prev.openGlyph !== next.openGlyph ||
    prev.row.key !== next.row.key ||
    prev.row.start !== next.row.start ||
    prev.row.glyphs.length !== next.row.glyphs.length
  ) {
    return false;
  }

  for (let index = 0; index < next.row.glyphs.length; index += 1) {
    if (prev.row.glyphs[index] !== next.row.glyphs[index]) return false;

    const glyphId = next.row.glyphs[index]!.id;
    const prevPreview = prev.previews.get(glyphId);
    const nextPreview = next.previews.get(glyphId);
    if (prevPreview === nextPreview) continue;
    if (!prevPreview || !nextPreview) return false;
    if (
      prevPreview.svgPath !== nextPreview.svgPath ||
      prevPreview.xAdvance !== nextPreview.xAdvance
    ) {
      return false;
    }
  }

  return true;
}

export const GlyphGridRow = memo(function GlyphGridRow({
  row,
  cellWidth,
  previews,
  metrics,
  openGlyph,
}: GlyphGridRowProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        transform: `translateY(${row.start}px)`,
      }}
      className="flex gap-2 px-4"
    >
      {row.glyphs.map((glyph) => {
        const preview = previews.get(glyph.id);

        return (
          <div
            key={glyph.id}
            className="flex min-w-0 flex-col items-center gap-2"
            style={{
              minHeight: CELL_HEIGHT + 20,
              width: cellWidth,
              maxWidth: cellWidth,
            }}
          >
            {preview ? (
              <Button
                variant="ghost"
                className="w-full min-w-0 overflow-hidden"
                style={{ height: CELL_HEIGHT }}
                onClick={async () => {
                  await openGlyph(glyph);
                }}
              >
                <GlyphPreview preview={preview} metrics={metrics} height={CELL_HEIGHT} />
              </Button>
            ) : (
              <div
                style={{ height: CELL_HEIGHT }}
                className="w-full rounded-md bg-current opacity-[0.04]"
              />
            )}
            <GlyphNameInput glyph={glyph} />
          </div>
        );
      })}
    </div>
  );
}, rowPropsEqual);
