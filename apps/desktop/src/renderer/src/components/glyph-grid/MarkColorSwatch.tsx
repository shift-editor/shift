import type { MouseEvent } from "react";
import type { MarkColor } from "@shift/types";
import { Button, Tooltip } from "@shift/ui";
import { markColorCss } from "@/lib/glyph-grid/markColor";

interface MarkColorSwatchProps {
  /** The colour shown; null is the swatch for no colour. */
  readonly color: MarkColor | null;
  /** What pressing the swatch does, as its tooltip and accessible name. */
  readonly label: string;
  readonly pressed: boolean;
  readonly onPress: (event: MouseEvent<HTMLElement>) => void;
}

/** A small card in a tag colour that toggles: one of a row of colours to pick or filter by. */
export function MarkColorSwatch({ color, label, pressed, onPress }: MarkColorSwatchProps) {
  return (
    <Tooltip content={label}>
      <Button
        aria-label={label}
        aria-pressed={pressed}
        isActive={pressed}
        variant="ghost"
        size="icon-sm"
        onClick={onPress}
      >
        <span
          aria-hidden="true"
          className="block h-3.5 w-3.5 rounded-xs border border-tile-ink bg-tile"
          // A tag's colour is data; the untagged swatch keeps bg-tile.
          style={{ background: color ? markColorCss(color) : undefined }}
        />
      </Button>
    </Tooltip>
  );
}
