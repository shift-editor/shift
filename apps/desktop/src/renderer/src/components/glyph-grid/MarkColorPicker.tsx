import { useState } from "react";
import type { MarkColor } from "@shift/types";
import { Button } from "@shift/ui";
import { MarkColorSwatch } from "./MarkColorSwatch";
import {
  GRID_MARK_COLORS,
  MAIN_MARK_COLORS,
  MORE_MARK_COLORS,
  UNTAGGED,
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
  /**
   * `row`: the seven main colours, the rest under More, for a menu.
   * `grid`: all twelve, four to a row, with No colour under them, for a panel
   * with room for them.
   */
  readonly layout?: "row" | "grid";
}

/**
 * The tag colours to give glyphs: the twelve named ones, a swatch for each
 * colour outside the twelve that the glyphs already have, and a way to clear
 * the colour. A swatch is pressed when every glyph has its colour.
 */
export function MarkColorPicker({ current, onPick, layout = "row" }: MarkColorPickerProps) {
  const [more, setMore] = useState(false);
  const custom = current
    .values()
    .filter((color) => color?.kind === "custom")
    .toArray();
  const [only] = current.size === 1 ? current.keys() : [];
  const swatch = (color: MarkColor | null) => (
    <MarkColorSwatch
      key={markColorKey(color)}
      color={color}
      label={color ? capitalized(markColorLabel(color)) : "Clear colour"}
      pressed={only === markColorKey(color)}
      onPress={() => onPick(color)}
    />
  );

  if (layout === "grid") {
    const named = GRID_MARK_COLORS.map((name): MarkColor => ({ kind: "named", named: name }));

    return (
      <div role="group" aria-label="Colour" className="flex flex-col gap-1">
        <div className="grid grid-cols-4 gap-0.5">
          {named.map(swatch)}
          {custom.map(swatch)}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-ui"
          aria-pressed={only === UNTAGGED}
          isActive={only === UNTAGGED}
          onClick={() => onPick(null)}
        >
          No colour
        </Button>
      </div>
    );
  }

  const named = more ? [...MAIN_MARK_COLORS, ...MORE_MARK_COLORS] : MAIN_MARK_COLORS;
  const colors: readonly (MarkColor | null)[] = [
    ...named.map((name): MarkColor => ({ kind: "named", named: name })),
    ...custom,
    null,
  ];

  return (
    <div role="group" aria-label="Colour" className="flex flex-wrap items-center gap-0.5">
      {colors.map(swatch)}
      <Button
        variant="muted"
        size="sm"
        className="text-ui"
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

/** A colour's name as a tooltip shows it: `Orange`, `Light green`. */
function capitalized(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
