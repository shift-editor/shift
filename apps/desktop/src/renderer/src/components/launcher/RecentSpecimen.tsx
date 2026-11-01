import { cn } from "@shift/ui";
import type { NameFit, NameSpecimen, Specimen } from "@shift/types";

/** Font size of the specimen on a small tile, in CSS pixels. */
const TILE_SPECIMEN_SIZE = 56;
/** Font size of the specimen the wide tile falls back to, in CSS pixels. */
const WIDE_TILE_SPECIMEN_SIZE = 72;

/** Space under the wide tile's name, by the rule that fitted it, or under its fallback specimen. */
const WIDE_TILE_BOTTOM_PADDING: Record<NameFit | "specimen", string> = {
  full: "pb-4",
  scaled: "pb-4",
  twoLines: "pb-[18px]",
  specimen: "pb-3.5",
};

/**
 * Draws a cached specimen outline as text set at `fontSize` CSS pixels,
 * shrinking to fit when its box is narrower.
 */
export const SpecimenOutline = ({
  specimen,
  fontSize,
  className,
}: {
  specimen: Specimen;
  fontSize: number;
  className?: string;
}) => {
  const viewBoxWidth = specimen.viewBox[2] ?? 0;
  const width = (viewBoxWidth * fontSize) / specimen.unitsPerEm;

  return (
    <svg
      aria-hidden="true"
      viewBox={specimen.viewBox.join(" ")}
      style={{ width }}
      className={cn("h-auto max-h-full max-w-full fill-current text-primary", className)}
    >
      <path d={specimen.outline} />
    </svg>
  );
};

/** Draws a specimen scaled to fill its box, as on a list row's chip. */
export const FittedSpecimen = ({
  specimen,
  className,
}: {
  specimen: Specimen | null;
  className?: string;
}) => {
  if (!specimen) return null;

  const alignment = specimen.rightToLeft ? "xMaxYMid meet" : "xMidYMid meet";
  return (
    <svg
      aria-hidden="true"
      viewBox={specimen.viewBox.join(" ")}
      preserveAspectRatio={alignment}
      className={cn("fill-current text-primary", className)}
    >
      <path d={specimen.outline} />
    </svg>
  );
};

/** Draws a family name at the size Rust fitted it to, its ink starting at the left edge. */
const FamilyNameOutline = ({ name }: { name: NameSpecimen }) => (
  <svg
    aria-hidden="true"
    viewBox={name.viewBox.join(" ")}
    width={name.width}
    height={name.height}
    className="shrink-0 overflow-visible fill-current text-primary"
  >
    <path d={name.outline} />
  </svg>
);

/** A small tile's specimen, centred. */
export const TileSpecimen = ({ specimen }: { specimen: Specimen | null }) => {
  if (!specimen) return null;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <SpecimenOutline specimen={specimen} fontSize={TILE_SPECIMEN_SIZE} />
    </div>
  );
};

/**
 * The wide tile's content: "Last opened", then the family name drawn in the
 * font, or the specimen when the name does not fit legibly.
 */
export const LastOpenedSpecimen = ({ specimen }: { specimen: Specimen | null }) => {
  const familyName = specimen?.familyName ?? null;
  const padding = WIDE_TILE_BOTTOM_PADDING[familyName?.fit ?? "specimen"];

  return (
    <div className={cn("flex h-full flex-col justify-between px-6 pt-4", padding)}>
      <span className="text-ui/3.5 font-medium text-secondary">Last opened</span>
      {familyName && <FamilyNameOutline name={familyName} />}
      {!familyName && specimen && (
        <SpecimenOutline
          specimen={specimen}
          fontSize={WIDE_TILE_SPECIMEN_SIZE}
          className="self-start"
        />
      )}
    </div>
  );
};
