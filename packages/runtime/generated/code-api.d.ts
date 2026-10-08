//#region ../geo/src/types.d.ts
type Point2D = {
  x: number;
  y: number;
};
type Rect2D = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};
//#endregion
//#region ../geo/src/Bounds.d.ts
/**
 * Axis-aligned bounding box defined by its minimum and maximum corners.
 *
 * In screen/canvas space, `min` is the top-left corner and `max` is the
 * bottom-right. In UPM space (y-up), `min.y` is the bottom and `max.y`
 * is the top.
 */
interface Bounds {
  readonly min: {
    readonly x: number;
    readonly y: number;
  };
  readonly max: {
    readonly x: number;
    readonly y: number;
  };
}
declare const Bounds: {
  /** Create a bounds from explicit min and max corners. */
  readonly create: (min: Point2D, max: Point2D) => Bounds;
  /** Create a zero-area bounds located at a single point. */
  readonly fromPoint: (p: Point2D) => Bounds;
  /**
   * Compute the tightest bounds enclosing all given points.
   * @returns `null` when the array is empty.
   */
  readonly fromPoints: (points: readonly Point2D[]) => Bounds | null;
  /** Create bounds from an origin and dimensions (x, y, width, height). */
  readonly fromXYWH: (x: number, y: number, w: number, h: number) => Bounds;
  /** Return the smallest bounds that contains both `a` and `b`. */
  readonly union: (a: Bounds, b: Bounds) => Bounds;
  /**
   * Merge an array of nullable bounds into one. Skips `null` entries.
   * @returns `null` when every entry is `null`.
   */
  readonly unionAll: (bounds: readonly (Bounds | null)[]) => Bounds | null;
  /** Expand bounds just enough to include the given point. */
  readonly includePoint: (b: Bounds, p: Point2D) => Bounds;
  readonly width: (b: Bounds) => number;
  readonly height: (b: Bounds) => number;
  readonly center: (b: Bounds) => Point2D;
  /** Test whether a point lies inside or on the edge of the bounds. */
  readonly containsPoint: (b: Bounds, p: Point2D) => boolean;
  /** Test whether two bounds overlap (inclusive of touching edges). */
  readonly overlaps: (a: Bounds, b: Bounds) => boolean;
  /** Grow the bounds outward by `padding` on every side. Use a negative value to shrink. */
  readonly expand: (b: Bounds, padding: number) => Bounds;
  /** Convert to a {@link Rect2D} with x/y/width/height and edge accessors. */
  readonly toRect: (b: Bounds) => Rect2D;
};
//#endregion
//#region ../types/src/ids.d.ts
/**
 * Branded ID types for type-safe identification of font entities.
 *
 * These types ensure compile-time safety when working with IDs across the
 * TS/Rust boundary. Most ids are prefixed strings (`point_<short-id>`). The
 * renderer MINTS ids for entities it creates (client-minted ids: verbs return
 * identity synchronously; Rust validates and honors them); all other ids come
 * from Rust.
 */
declare const PointIdBrand: unique symbol;
declare const ContourIdBrand: unique symbol;
declare const AnchorIdBrand: unique symbol;
declare const AxisIdBrand: unique symbol;
declare const AxisLabelIdBrand: unique symbol;
declare const ComponentIdBrand: unique symbol;
declare const GlyphIdBrand: unique symbol;
declare const LayerIdBrand: unique symbol;
declare const MetricIdBrand: unique symbol;
declare const NamedInstanceIdBrand: unique symbol;
declare const NodeIdBrand: unique symbol;
declare const SegmentIdBrand: unique symbol;
declare const SourceIdBrand: unique symbol;
/**
 * A point identifier from Rust.
 * Branded string type - can't be confused with ContourId or plain strings.
 */
type PointId = string & {
  readonly [PointIdBrand]: typeof PointIdBrand;
};
/**
 * A contour identifier from Rust.
 * Branded string type - can't be confused with PointId or plain strings.
 */
type ContourId = string & {
  readonly [ContourIdBrand]: typeof ContourIdBrand;
};
/**
 * An anchor identifier from Rust.
 * Branded string type - can't be confused with PointId/ContourId or plain strings.
 */
type AnchorId = string & {
  readonly [AnchorIdBrand]: typeof AnchorIdBrand;
};
/**
 * An axis identifier from Rust.
 * Branded string type - can't be confused with OpenType axis tags.
 */
type AxisId = string & {
  readonly [AxisIdBrand]: typeof AxisIdBrand;
};
/** A stable identifier for one user-space axis label. */
type AxisLabelId = string & {
  readonly [AxisLabelIdBrand]: typeof AxisLabelIdBrand;
};
/**
 * A component identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
type ComponentId = string & {
  readonly [ComponentIdBrand]: typeof ComponentIdBrand;
};
/**
 * A glyph identifier from Rust.
 * Branded string type - can't be confused with names or other IDs.
 */
type GlyphId = string & {
  readonly [GlyphIdBrand]: typeof GlyphIdBrand;
};
/**
 * A layer identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
type LayerId = string & {
  readonly [LayerIdBrand]: typeof LayerIdBrand;
};
/** Stable identity of one font-owned metric definition. */
type MetricId = string & {
  readonly [MetricIdBrand]: typeof MetricIdBrand;
};
/** A stable identifier for one authored product preset. */
type NamedInstanceId = string & {
  readonly [NamedInstanceIdBrand]: typeof NamedInstanceIdBrand;
};
/**
 * A scene node identifier minted by the renderer.
 *
 * Node ids identify placed editor nodes. They are placement identity only;
 * commands that mutate authored glyph geometry must resolve the glyph layer
 * separately from document glyph identity and designspace location.
 */
type NodeId = string & {
  readonly [NodeIdBrand]: typeof NodeIdBrand;
};
/** Stable identity of one segment derived from its endpoint identities. */
type SegmentId = string & {
  readonly [SegmentIdBrand]: typeof SegmentIdBrand;
};
/**
 * A source identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
type SourceId = string & {
  readonly [SourceIdBrand]: typeof SourceIdBrand;
};
/** Identifies an editor-addressable scene node or glyph object. */
type ShiftId = NodeId | PointId | AnchorId | ContourId | SegmentId | ComponentId;
/** Identifies objects that can be selected by the editor. */
type SelectableId = ShiftId;
//#endregion
//#region ../types/src/bridge/generated.d.ts
type GlyphName = string;
interface AnchorData {
  id: AnchorId;
  name?: string;
}
interface Axis {
  id: AxisId;
  tag: string;
  name: string;
  role: AxisRole;
  axisType: AxisType;
  minimum?: number;
  default: number;
  maximum?: number;
  values?: Array<number>;
  labels: Array<AxisLabel>;
  hidden: boolean;
}
interface AxisLabel {
  id: AxisLabelId;
  name: string;
  value: number;
  minimum?: number;
  maximum?: number;
  linkedValue?: number;
  elidable: boolean;
}
type AxisRole = "external" | "internal";
type AxisType = "continuous" | "discrete";
interface ComponentData {
  id: ComponentId;
  baseGlyphId: GlyphId;
  baseGlyphName: GlyphName;
}
interface ContourData {
  id: ContourId;
  points: Array<PointData>;
  closed: boolean;
}
interface FontMetadata {
  familyName?: string;
  styleName?: string;
  versionMajor?: number;
  versionMinor?: number;
  copyright?: string;
  trademark?: string;
  designer?: string;
  designerUrl?: string;
  manufacturer?: string;
  manufacturerUrl?: string;
  license?: string;
  licenseUrl?: string;
  description?: string;
  note?: string;
}
interface FontMetrics {
  unitsPerEm: number;
}
interface GlyphStructure {
  contours: Array<ContourData>;
  anchors: Array<AnchorData>;
  components: Array<ComponentData>;
}
interface Location {
  values: Record<AxisId, number>;
}
/** NAPI projection of one explicit named product preset. */
interface NamedInstance {
  id: NamedInstanceId;
  name: string;
  location: Location;
  postscriptName?: string;
}
interface PointData {
  id: PointId;
  pointType: PointType;
  smooth: boolean;
}
type PointType = "onCurve" | "offCurve" | "qCurve";
interface Source {
  id: SourceId;
  name: string;
  location: Location;
  filename?: string;
  metricValues: Array<SourceMetricValue>;
  italicAngle?: number;
  lineGap?: number;
  underlinePosition?: number;
  underlineThickness?: number;
}
interface SourceMetricValue {
  metricId: MetricId;
  position: number;
  overshoot: number;
}
//#endregion
//#region ../types/src/workspace.d.ts
/** Immutable product mode for one live font session. */
type FontSessionMode = "preview" | "memory" | "workspace";
//#endregion
//#region src/capabilities.d.ts
export type ShiftSessionMode = FontSessionMode;
export type ShiftCaptureTarget = "window" | "editor";
/** Point-in-time PNG captured from one explicitly addressed Shift window. */
export interface ShiftCapture {
  captureId: string;
  windowId: number;
  target: ShiftCaptureTarget;
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
  scale: number;
  capturedAt: string;
}
/** One open Shift window that can be addressed through runtime capabilities. */
export interface ShiftSession {
  windowId: number;
  sessionId: string;
  mode: ShiftSessionMode;
  focused: boolean;
  editorConnected: boolean;
}
/** One external/user-space axis coordinate displayed by the editor. */
export interface AxisCoordinate {
  axisId: AxisId;
  value: number;
}
/** Glyph occurrence currently placed in the editor, when a glyph route is open. */
export interface EditorGlyph {
  glyphId: GlyphId;
  name: string;
  nodeId: NodeId;
  sourceId: SourceId;
}
/** Active editor tool and its published state discriminator. */
export interface EditorTool {
  id: string;
  state: string;
}
/** Renderer-owned facts for one live Shift window. */
export interface EditorView {
  route: string;
  glyph: EditorGlyph | null;
  activeSourceId: SourceId | null;
  editingSourceIds: SourceId[];
  externalLocation: AxisCoordinate[];
  selectionIds: SelectableId[];
  tool: EditorTool | null;
  dragging: boolean;
  editing: boolean;
  applyStatus: "idle" | "queued" | "applying" | null;
}
/** Editor facts paired with the explicit window and font-session target. */
export interface EditorInspection extends EditorView {
  windowId: number;
  sessionId: string;
  mode: ShiftSessionMode;
}
/** Current font facts from one explicitly targeted live session, including Home. */
export interface FontOverview {
  mode: ShiftSessionMode;
  metadata: FontMetadata;
  metrics: FontMetrics;
  glyphCount: number;
  axes: Axis[];
  /** Global font masters; glyph-specific supplementary sources are advertised on glyphs. */
  sources: Source[];
  namedInstances: NamedInstance[];
}
/** Directory identity; optional structure is for one requested authored source. */
export interface GlyphSummary {
  id: GlyphId;
  name: string;
  unicodes: number[];
  componentBaseGlyphIds: GlyphId[];
  /** Authored layer sources, including glyph-specific non-master sources. */
  sourceIds: SourceId[];
  structure?: GlyphStructure | null;
}
/** Select one glyph by stable ID or exact name, never by both. */
export type GlyphSelector =
  | {
      glyphId: GlyphId;
      name?: never;
    }
  | {
      name: GlyphName;
      glyphId?: never;
    };
/** One bounded page of glyphs in font directory order. */
export interface GlyphPage {
  items: GlyphSummary[];
  nextCursor: string | null;
}
/** Authored geometry of one glyph in one source, never an interpolated preview. */
export interface LayerView {
  glyphId: GlyphId;
  sourceId: SourceId;
  layerId: LayerId;
  structure: GlyphStructure;
  xAdvance: number;
  bounds: Bounds | null;
  anchors: {
    id: AnchorId;
    name: string | null;
    x: number;
    y: number;
  }[];
  points: {
    id: PointId;
    x: number;
    y: number;
    pointType: PointType;
    smooth: boolean;
  }[];
}
/** Optional authored-layer annotations included in portable SVG output. */
export interface LayerOverlays {
  points?: boolean;
  controlLines?: boolean;
  anchors?: boolean;
  components?: boolean;
  fontMetrics?: boolean;
  advanceWidth?: boolean;
}
/** Presentation overrides for semantic elements in an authored-layer rendering. */
export interface LayerAppearance {
  outlineFill?: string;
  onCurveStroke?: string;
  offCurveStroke?: string;
  handleFill?: string;
  controlStroke?: string;
  anchorStroke?: string;
  metricStroke?: string;
  advanceStroke?: string;
  componentStroke?: string;
}
/** Structured guide positions accompanying an authored-layer rendering. */
export interface LayerGuides {
  fontMetrics: {
    ascender: number;
    capHeight?: number;
    xHeight?: number;
    baseline: number;
    descender: number;
  };
  advanceWidth: {
    origin: number;
    advance: number;
  };
}
/** Portable SVG rendering of one authored glyph layer. */
export interface LayerSvg {
  glyphId: GlyphId;
  sourceId: SourceId;
  layerId: LayerId;
  viewBox: [number, number, number, number];
  guides: LayerGuides;
  svg: string;
}
/** Live application capabilities shared by protocol and plugin hosts. */
export interface ShiftCapabilities {
  capture(input: {
    windowId: number;
    target: ShiftCaptureTarget;
    /** Output multiplier relative to logical UI pixels. Defaults to 1. */
    scale?: number;
  }): Promise<ShiftCapture>;
  sessions: {
    list(): Promise<ShiftSession[]>;
  };
  editor: {
    inspect(input: { windowId: number }): Promise<EditorInspection>;
  };
  font: {
    get(input: { windowId: number }): Promise<FontOverview>;
  };
  glyphs: {
    list(input: {
      windowId: number;
      limit?: number;
      cursor?: string;
      sourceId?: SourceId;
    }): Promise<GlyphPage>;
    get(
      input: {
        windowId: number;
      } & GlyphSelector,
    ): Promise<GlyphSummary>;
  };
  layers: {
    get(input: {
      windowId: number;
      glyphId: GlyphId;
      sourceId: SourceId;
    }): Promise<LayerView | null>;
    render(input: {
      windowId: number;
      glyphId: GlyphId;
      sourceId: SourceId;
      overlays?: LayerOverlays;
      appearance?: LayerAppearance;
    }): Promise<LayerSvg | null>;
  };
}
//#endregion

declare global {
  const shift: ShiftCapabilities;
}
