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
  /** Whether two bounds (or two empty results) have identical corners. */
  readonly equals: (a: Bounds | null, b: Bounds | null) => boolean;
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
declare const KerningGroupIdBrand: unique symbol;
declare const LayerIdBrand: unique symbol;
declare const MetricIdBrand: unique symbol;
declare const NamedInstanceIdBrand: unique symbol;
declare const NodeIdBrand: unique symbol;
declare const SegmentIdBrand: unique symbol;
declare const TextItemIdBrand: unique symbol;
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
 * A kerning group identifier from Rust. Pairs reference a group by id, so a
 * group keeps its kerning when renamed.
 */
type KerningGroupId = string & {
  readonly [KerningGroupIdBrand]: typeof KerningGroupIdBrand;
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
/** Identity of a glyph or linebreak within a proof text run. */
type TextItemId = string & {
  readonly [TextItemIdBrand]: typeof TextItemIdBrand;
};
/**
 * A source identifier from Rust.
 * Branded string type - can't be confused with other IDs or plain strings.
 */
type SourceId = string & {
  readonly [SourceIdBrand]: typeof SourceIdBrand;
};
/** Identifies an editor-addressable scene node or glyph object. */
type ShiftId = NodeId | PointId | AnchorId | ContourId | SegmentId | ComponentId | TextItemId;
/** Identifies objects that can be selected by the editor. */
type SelectableId = ShiftId;
//#endregion
//#region ../types/src/bridge/generated.d.ts
type GlyphName = string;
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
type KerningPosition = "first" | "second";
interface Location {
  values: Record<AxisId, number>;
}
interface MetricDefinition {
  id: MetricId;
  kind: MetricKind;
  name: string;
}
type MetricKind = "ascender" | "capHeight" | "xHeight" | "baseline" | "descender" | "custom";
/** NAPI projection of one explicit named product preset. */
interface NamedInstance {
  id: NamedInstanceId;
  name: string;
  location: Location;
  postscriptName?: string;
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
//#region ../types/src/domain.d.ts
/** Standard and technical metrics resolved for one authored source. */
type SourceMetrics = Readonly<
  FontMetrics & {
    metricValues: readonly SourceMetricValue[];
    ascender: number;
    descender: number;
    baseline: number;
    capHeight?: number;
    xHeight?: number;
    lineGap?: number;
    italicAngle?: number;
    underlinePosition?: number;
    underlineThickness?: number;
  }
>;
//#endregion
//#region ../types/src/workspace.d.ts
/** Immutable product mode for one live font session. */
type FontSessionMode = "preview" | "memory" | "workspace";
//#endregion
//#region src/capabilities.d.ts
export type ShiftSessionMode = FontSessionMode;
export type ShiftCaptureTarget = "window" | "editor";
/** Opaque identity of one live session's authored font state. */
export type FontRevision = string;
/** Result read entirely from one authored font revision. */
export interface ShiftObservation<Value> {
  fontRevision: FontRevision;
  value: Value;
}
/** Explicit live-window target with an optional authored-state precondition. */
export interface ShiftTarget {
  windowId: number;
  ifFontRevision?: FontRevision;
}
export interface ShiftCaptureInput extends ShiftTarget {
  target: ShiftCaptureTarget;
  /** Output multiplier relative to logical UI pixels. Defaults to 1. */
  scale?: number;
}
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
/** One axis coordinate keyed by stable font-owned identity. */
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
  info: FontMetadata;
  metrics: FontMetrics;
  metricDefinitions: MetricDefinition[];
  glyphCount: number;
  axes: Axis[];
  /** Global designspace sources; glyph-specific layers are advertised on glyphs. */
  sources: Source[];
  instances: NamedInstance[];
}
/** Stable reference to one authored glyph layer. */
export interface GlyphLayerReference {
  layerId: LayerId;
  sourceId: SourceId;
}
/** Directory identity with optional geometry for one requested authored source. */
export interface GlyphSummary {
  id: GlyphId;
  name: string;
  unicodes: number[];
  componentBaseGlyphIds: GlyphId[];
  layers: GlyphLayerReference[];
  layer?: AuthoredLayer | null;
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
/** One point nested in its authored contour. */
export interface AuthoredPoint {
  id: PointId;
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
}
/** One directly authored contour and its ordered points. */
export interface AuthoredContour {
  id: ContourId;
  closed: boolean;
  points: AuthoredPoint[];
}
/** One directly authored anchor. */
export interface AuthoredAnchor {
  id: AnchorId;
  name: string | null;
  x: number;
  y: number;
}
/** Conventional six-value affine component transformation. */
export interface AffineTransformation {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
  dx: number;
  dy: number;
}
/** One direct component reference owned by an authored layer. */
export interface AuthoredComponent {
  id: ComponentId;
  baseGlyphId: GlyphId;
  baseGlyphName: string;
  transformation: AffineTransformation;
}
/** Authored geometry of one glyph in one source, never an interpolated preview. */
export interface AuthoredLayer {
  glyphId: GlyphId;
  sourceId: SourceId;
  layerId: LayerId;
  advanceWidth: number;
  bounds: Bounds | null;
  contours: AuthoredContour[];
  components: AuthoredComponent[];
  anchors: AuthoredAnchor[];
}
/** One direct component of a resolved layer; its outline includes every resolved descendant. */
export interface ResolvedComponent {
  id: ComponentId;
  baseGlyphId: GlyphId;
  transformation: AffineTransformation;
  /** One SVG path in font units, y-up, with tight bounds. */
  outline: {
    svgPath: string;
    bounds: Bounds | null;
  };
}
/**
 * One exact authored layer with components resolved at its own source.
 *
 * The outline is the root's contours plus every component descendant; cyclic
 * component branches are skipped.
 */
export interface ResolvedLayer {
  glyphId: GlyphId;
  sourceId: SourceId;
  layerId: LayerId;
  advanceWidth: number;
  /** One SVG path in font units, y-up, with tight bounds. */
  outline: {
    svgPath: string;
    bounds: Bounds | null;
  };
  components: ResolvedComponent[];
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
/** External and mapped coordinates with metrics resolved at that location. */
export interface ResolvedLocation {
  externalLocation: AxisCoordinate[];
  designLocation: AxisCoordinate[];
  sourceId: SourceId | null;
  metrics: SourceMetrics;
}
/** Drawable glyph output resolved at one designspace location. */
export interface ResolvedGlyph {
  glyphId: GlyphId;
  svgPath: string;
  advanceWidth: number;
}
/** Batch resolution result; unresolved identities have no drawable preview. */
export interface ResolvedGlyphs {
  items: ResolvedGlyph[];
  unresolvedGlyphIds: GlyphId[];
}
export interface GlyphListInput extends ShiftTarget {
  limit?: number;
  cursor?: string;
  sourceId?: SourceId;
}
export type GlyphGetInput = ShiftTarget & GlyphSelector;
export interface GlyphResolveInput extends ShiftTarget {
  glyphIds: GlyphId[];
  location: AxisCoordinate[];
}
/** Addresses one authored layer by its stable identity. */
export interface LayerGetInput extends ShiftTarget {
  layerId: LayerId;
}
export type LayerResolveInput = LayerGetInput;
export interface LayerRenderInput extends LayerGetInput {
  overlays?: LayerOverlays;
  appearance?: LayerAppearance;
}
export interface LocationResolveInput extends ShiftTarget {
  location: AxisCoordinate[];
}
/** A glyph by stable identity, with its current name. */
export interface KerningGlyph {
  glyphId: GlyphId;
  /** Null when the glyph is no longer in the font. */
  name: string | null;
}
/** One font-wide kerning group and its members at one pair position. */
export interface KerningGroupSummary {
  groupId: KerningGroupId;
  name: string;
  /** `first` groups kern before the other glyph, `second` groups after it. */
  position: KerningPosition;
  members: KerningGlyph[];
}
/** One side of an authored kerning pair: a single glyph or a kerning group. */
export type KerningPairSide =
  | {
      kind: "glyph";
      glyphId: GlyphId;
      name: string | null;
    }
  | {
      kind: "group";
      groupId: KerningGroupId;
      name: string;
    };
/** One pair value authored at a source, in font units added after the first side. */
export interface AuthoredKerningPair {
  first: KerningPairSide;
  second: KerningPairSide;
  amount: number;
}
/** One bounded page of a source's authored pairs, ordered by side identities. */
export interface KerningPairPage {
  sourceId: SourceId;
  items: AuthoredKerningPair[];
  nextCursor: string | null;
}
/**
 * Which kind of authored pair applies between two glyphs: `glyph` (both sides
 * glyphs), `mixed` (a glyph exception against a group), `group` (both sides
 * groups), or `none`. A more specific pair always beats a more general one.
 */
export type KerningRule = "glyph" | "mixed" | "group" | "none";
/**
 * How a master arrives at its kerning for a pair: an `authored` pair applies;
 * the master kerns other pairs but not this one (`unkerned`, so 0); or it
 * authors no kerning and takes the blend of the masters that do (`interpolated`).
 */
export type KerningOrigin = "authored" | "unkerned" | "interpolated";
/** The kerning between two glyphs at one master. */
export interface KerningMasterValue {
  sourceId: SourceId;
  amount: number;
  origin: KerningOrigin;
  rule: KerningRule;
  /** The authored pair that applies; null unless `origin` is `authored`. */
  pair: AuthoredKerningPair | null;
}
/** The kerning between two glyphs, as the compiled font applies it. */
export interface KerningResolution {
  first: KerningGlyph;
  second: KerningGlyph;
  /** Font units at the requested source or location. */
  amount: number;
  /** Every master's value for the pair, in font source order. */
  masters: KerningMasterValue[];
}
/** Batch kerning resolution, in request order. */
export interface ResolvedKerningPairs {
  items: KerningResolution[];
}
export interface KerningGroupsInput extends ShiftTarget {
  position?: KerningPosition;
}
export interface KerningPairsInput extends ShiftTarget {
  sourceId: SourceId;
  /** Only pairs that apply to this glyph (exact name or id), directly or through its groups. */
  glyph?: string;
  limit?: number;
  cursor?: string;
}
/** Two glyphs, first then second, each by exact name or stable glyph id. */
export interface KerningPairQuery {
  first: string;
  second: string;
}
/** Resolves at one master (`sourceId`), an external `location`, or else the default location. */
export interface KerningResolveInput extends ShiftTarget {
  pairs: KerningPairQuery[];
  sourceId?: SourceId;
  location?: AxisCoordinate[];
}
/** Live application capabilities shared by protocol and plugin hosts. */
export interface ShiftCapabilities {
  capture(input: ShiftCaptureInput): Promise<ShiftObservation<ShiftCapture>>;
  sessions: {
    list(): Promise<ShiftSession[]>;
  };
  editor: {
    inspect(input: ShiftTarget): Promise<ShiftObservation<EditorInspection>>;
  };
  font: {
    get(input: ShiftTarget): Promise<ShiftObservation<FontOverview>>;
  };
  locations: {
    resolve(input: LocationResolveInput): Promise<ShiftObservation<ResolvedLocation>>;
  };
  glyphs: {
    list(input: GlyphListInput): Promise<ShiftObservation<GlyphPage>>;
    get(input: GlyphGetInput): Promise<ShiftObservation<GlyphSummary>>;
    resolve(input: GlyphResolveInput): Promise<ShiftObservation<ResolvedGlyphs>>;
  };
  layers: {
    get(input: LayerGetInput): Promise<ShiftObservation<AuthoredLayer>>;
    resolve(input: LayerResolveInput): Promise<ShiftObservation<ResolvedLayer>>;
    render(input: LayerRenderInput): Promise<ShiftObservation<LayerSvg>>;
  };
  kerning: {
    groups(input: KerningGroupsInput): Promise<ShiftObservation<KerningGroupSummary[]>>;
    pairs(input: KerningPairsInput): Promise<ShiftObservation<KerningPairPage>>;
    resolve(input: KerningResolveInput): Promise<ShiftObservation<ResolvedKerningPairs>>;
  };
}
/** A capability input without the window and revision a read scope binds. */
export type ShiftReadInput<Input> = Input extends unknown ? Omit<Input, keyof ShiftTarget> : never;
/**
 * `active` while the bound revision is current; `stale` once a call saw the
 * font change; `closed` once the scope's callback settled. Both are terminal.
 */
export type ShiftReadState = "active" | "stale" | "closed";
/**
 * Revision-bound reads of one window's font, valid only inside `shift.read`.
 *
 * Calls return plain values. The first call that sees a newer font revision
 * moves the scope to `stale` and throws an error named `FontChangedError`;
 * every later call fails the same way. Nothing is retried, and other errors
 * leave the scope `active`.
 */
export interface ShiftRead {
  readonly state: ShiftReadState;
  /** The revision every call in this scope requires. */
  readonly fontRevision: FontRevision;
  font: {
    get(): Promise<FontOverview>;
  };
  locations: {
    resolve(input: ShiftReadInput<LocationResolveInput>): Promise<ResolvedLocation>;
  };
  glyphs: {
    list(input?: ShiftReadInput<GlyphListInput>): Promise<GlyphPage>;
    get(input: ShiftReadInput<GlyphGetInput>): Promise<GlyphSummary>;
    resolve(input: ShiftReadInput<GlyphResolveInput>): Promise<ResolvedGlyphs>;
  };
  layers: {
    get(input: ShiftReadInput<LayerGetInput>): Promise<AuthoredLayer>;
    resolve(input: ShiftReadInput<LayerResolveInput>): Promise<ResolvedLayer>;
    render(input: ShiftReadInput<LayerRenderInput>): Promise<LayerSvg>;
  };
  kerning: {
    groups(input?: ShiftReadInput<KerningGroupsInput>): Promise<KerningGroupSummary[]>;
    pairs(input: ShiftReadInput<KerningPairsInput>): Promise<KerningPairPage>;
    resolve(input: ShiftReadInput<KerningResolveInput>): Promise<ResolvedKerningPairs>;
  };
}
/** The `shift` global in scripts: raw capabilities plus revision-bound reads. */
export interface ShiftScript extends ShiftCapabilities {
  /**
   * Runs `callback` against one revision of a window's font.
   *
   * @returns The callback's result; the callback is never retried.
   */
  read<Result>(
    target: {
      windowId: number;
    },
    callback: (read: ShiftRead) => Result | Promise<Result>,
  ): Promise<Result>;
}
//#endregion

declare global {
  const shift: ShiftScript;
}
