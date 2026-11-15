import { Slider } from "@shift/ui";
import { MarkColorSwatch } from "../glyph-grid/MarkColorSwatch";
import type { MarkColorCount } from "@/lib/glyph-grid/colorFilter";
import { TILE_SIZE, type MarkColorFilter } from "@/lib/glyph-grid/GlyphGridView";
import { markColorLabel } from "@/lib/glyph-grid/markColor";
import type { MarkColor } from "@shift/types";

interface GlyphGridFooterProps {
  /** The colours the grid can be filtered to; empty when no glyph is tagged. */
  readonly colors: readonly MarkColorCount[];
  readonly colorFilter: MarkColorFilter;
  /** Filters by a colour, or with `add` adds it to or takes it out of the colours shown. */
  readonly filterColor: (color: MarkColor | null, add: boolean) => void;
  readonly tileSize: number;
  readonly setTileSize: (size: number) => void;
}

/** The strip under the glyph grid: the colour filter and tile size. */
export function GlyphGridFooter({
  colors,
  colorFilter,
  filterColor,
  tileSize,
  setTileSize,
}: GlyphGridFooterProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-line-subtle px-4 font-ui text-ui text-secondary">
      <div role="group" aria-label="Filter by colour" className="flex items-center gap-0.5">
        {colors.map(({ key, color }) => (
          <MarkColorSwatch
            key={key}
            color={color}
            label={color ? `Show ${markColorLabel(color)} glyphs` : "Show untagged glyphs"}
            pressed={colorFilter.has(key)}
            dimmed={colorFilter.size > 0 && !colorFilter.has(key)}
            onPress={(event) => filterColor(color, event.metaKey || event.ctrlKey)}
          />
        ))}
      </div>
      <Slider
        aria-label="Tile size"
        className="ml-auto w-28"
        min={TILE_SIZE.min}
        max={TILE_SIZE.max}
        value={tileSize}
        onValueChange={setTileSize}
      />
    </footer>
  );
}
