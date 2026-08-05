import type {
  AnchorId,
  Axis,
  AxisMapping,
  ContourId,
  GlyphEntry,
  GlyphId,
  GlyphProjection,
  PointId,
  Source,
  SourceId,
} from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";
import type { Glyph, GlyphLayer } from "@/lib/model/Glyph";
import type { Signal } from "@/lib/signals/signal";

export interface GlyphGeometrySelection {
  readonly points?: Iterable<PointId>;
  readonly anchors?: Iterable<AnchorId>;
  readonly contours?: Iterable<ContourId>;
  readonly segments?: Iterable<SegmentId>;
}

export interface GlyphOptions {
  readonly entry: GlyphEntry;
  readonly layers: readonly GlyphLayer[];
  readonly componentGlyphs: ReadonlyMap<GlyphId, Glyph>;
  readonly axesCell: Signal<Axis[]>;
  readonly axisMappingsCell: Signal<AxisMapping[]>;
  readonly sourcesCell: Signal<Source[]>;
  readonly projectionCell: Signal<GlyphProjection | null>;
  readonly defaultSourceId: SourceId;
}
