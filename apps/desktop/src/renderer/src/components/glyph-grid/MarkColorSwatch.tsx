import type { MouseEvent } from "react";
import type { MarkColor } from "@shift/types";
import { Button, cn, Tooltip } from "@shift/ui";
import { markColorCss } from "@/lib/glyph-grid/markColor";

interface MarkColorSwatchProps {
  /** The colour shown; null is the swatch for no colour. */
  readonly color: MarkColor | null;
  /** What pressing the swatch does, as its tooltip and accessible name. */
  readonly label: string;
  readonly pressed: boolean;
  /** Faded, as the colours left out while a filter shows others. */
  readonly dimmed?: boolean;
  readonly onPress: (event: MouseEvent<HTMLElement>) => void;
}

/** A dot in a tag colour that toggles: one of a row of colours to pick or filter by. */
export function MarkColorSwatch({
  color,
  label,
  pressed,
  dimmed = false,
  onPress,
}: MarkColorSwatchProps) {
  return (
    <Tooltip content={label}>
      <Button
        aria-label={label}
        aria-pressed={pressed}
        // A pressed swatch sits on the ghost button's active tile.
        isActive={pressed}
        variant="ghost"
        size="icon-sm"
        onClick={onPress}
      >
        <span
          aria-hidden="true"
          className={cn(
            "block h-3.5 w-3.5 rounded-full",
            // The untagged dot is hollow.
            color ? null : "border border-control-muted bg-surface",
            dimmed && "opacity-35",
          )}
          // A tag's colour is data.
          style={{ background: color ? markColorCss(color) : undefined }}
        />
      </Button>
    </Tooltip>
  );
}
