import type { Bounds } from "@shift/geo";
import type {
  AnchorId,
  Axis,
  AxisId,
  ComponentId,
  ContourId,
  FontMetadata,
  FontMetrics,
  FontSessionMode,
  GlyphId,
  GlyphName,
  LayerId,
  MetricDefinition,
  NamedInstance,
  NodeId,
  PointId,
  PointType,
  SelectableId,
  Source,
  SourceId,
  SourceMetrics,
} from "@shift/types";

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
  | { glyphId: GlyphId; name?: never }
  | { name: GlyphName; glyphId?: never };

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

export interface LayerGetInput extends ShiftTarget {
  glyphId: GlyphId;
  sourceId: SourceId;
}

export interface LayerRenderInput extends LayerGetInput {
  overlays?: LayerOverlays;
  appearance?: LayerAppearance;
}

export interface LocationResolveInput extends ShiftTarget {
  location: AxisCoordinate[];
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
    get(input: LayerGetInput): Promise<ShiftObservation<AuthoredLayer | null>>;
    render(input: LayerRenderInput): Promise<ShiftObservation<LayerSvg | null>>;
  };
}
