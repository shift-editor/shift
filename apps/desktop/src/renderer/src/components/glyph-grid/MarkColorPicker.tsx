import { useState } from "react";
import type { MarkColor } from "@shift/types";
import { Button } from "@shift/ui";
import { MarkColorSwatch } from "./MarkColorSwatch";
import {
  MAIN_MARK_COLORS,
  MORE_MARK_COLORS,
  markColorKey,
  markColorLabel,
  type MarkColorKey,
} from "@/lib/glyph-grid/markColor";

interface MarkColorPickerProps {
  /**
   * The colours the glyphs being tagged have now, by key (`UNTAGGED` for
   * none): one key when they agree, several when they are mixed.
   */
  readonly current: ReadonlyMap<MarkColorKey, MarkColor | null>;
  /** Tags the glyphs with a colour, or clears their colour with null. */
  readonly onPick: (color: MarkColor | null) => void;
}

/**
 * A row of tag colours to give glyphs: the seven main ones, the rest under
 * More, a swatch for no colour, and a swatch for each colour outside the
 * twelve that the glyphs already have. A swatch is pressed when every glyph
 * has its colour.
 */
export function MarkColorPicker({ current, onPick }: MarkColorPickerProps) {
  const [more, setMore] = useState(false);
  const named = more ? [...MAIN_MARK_COLORS, ...MORE_MARK_COLORS] : MAIN_MARK_COLORS;
  const custom = current
    .values()
    .filter((color) => color?.kind === "custom")
    .toArray();
  const colors: readonly (MarkColor | null)[] = [
    ...named.map((name): MarkColor => ({ kind: "named", named: name })),
    ...custom,
    null,
  ];
  const [only] = current.size === 1 ? current.keys() : [];

  return (
    <div role="group" aria-label="Colour" className="flex flex-wrap items-center gap-0.5">
      {colors.map((color) => (
        <MarkColorSwatch
          key={markColorKey(color)}
          color={color}
          label={color ? `Tag ${markColorLabel(color)}` : "Clear colour"}
          pressed={only === markColorKey(color)}
          onPress={() => onPick(color)}
        />
      ))}
      <Button
        variant="muted"
        size="sm"
        aria-expanded={more}
        onClick={(event) => {
          // Shows more colours in place; a menu holding the row stays open.
          event.stopPropagation();
          setMore((shown) => !shown);
        }}
      >
        {more ? "Less" : "More"}
      </Button>
    </div>
  );
}
