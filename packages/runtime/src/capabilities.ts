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
  KerningGroupId,
  KerningPosition,
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

/** Select one source by stable ID or exact name, never by both. */
export type SourceSelector =
  | { sourceId: SourceId; name?: never }
  | { name: string; sourceId?: never };

/**
 * Select one authored layer by stable ID, or as a glyph's layer at a source,
 * never both. Without `source`, the glyph's layer at the default source.
 */
export type LayerSelector =
  | { layerId: LayerId; glyph?: never; source?: never }
  | { glyph: GlyphSelector; source?: SourceSelector; layerId?: never };

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
  outline: { svgPath: string; bounds: Bounds | null };
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
  outline: { svgPath: string; bounds: Bounds | null };
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
  /** Nests each glyph's authored layer at this source. */
  source?: SourceSelector;
}

export type GlyphGetInput = ShiftTarget & GlyphSelector;

export interface GlyphResolveInput extends ShiftTarget {
  glyphIds: GlyphId[];
  location: AxisCoordinate[];
}

/** Addresses one authored layer by its stable identity, or by glyph and source. */
export type LayerGetInput = ShiftTarget & LayerSelector;

export type LayerResolveInput = LayerGetInput;

export type LayerRenderInput = LayerGetInput & {
  overlays?: LayerOverlays;
  appearance?: LayerAppearance;
};

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
  | { kind: "glyph"; glyphId: GlyphId; name: string | null }
  | { kind: "group"; groupId: KerningGroupId; name: string };

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
 * glyphs), `exception` (a glyph against a group, overriding the group pair), `group` (both sides
 * groups), or `none`. A more specific pair always beats a more general one.
 */
export type KerningRule = "glyph" | "exception" | "group" | "none";

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
  /** The master whose pairs to list; the default source when omitted. */
  source?: SourceSelector;
  /** Only pairs that apply to this glyph, directly or through its groups. */
  glyph?: GlyphSelector;
  limit?: number;
  cursor?: string;
}

/** Two glyphs, first then second, each selected by exact name or stable glyph id. */
export interface KerningPairQuery {
  first: GlyphSelector;
  second: GlyphSelector;
}

/** Resolves at one master (`source`), an external `location`, or else the default location. */
export interface KerningResolveInput extends ShiftTarget {
  pairs: KerningPairQuery[];
  source?: SourceSelector;
  // oxlint-disable-next-line shift/no-optional-collection-field -- absent means "use source or the default location", not an empty location
  location?: AxisCoordinate[];
}

/** One pair, first glyph then second, at one master; the default source when `source` is omitted. */
export interface KerningAtInput extends ShiftTarget {
  first: GlyphSelector;
  second: GlyphSelector;
  source?: SourceSelector;
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
    at(input: KerningAtInput): Promise<ShiftObservation<KerningMasterValue>>;
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
    at(input: ShiftReadInput<KerningAtInput>): Promise<KerningMasterValue>;
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
    target: { windowId: number },
    callback: (read: ShiftRead) => Result | Promise<Result>,
  ): Promise<Result>;
}

/** One item of a canvas text run: a typed character, a glyph picked by name, or a line break. */
export interface TextRunItem {
  id: string;
  /** The character, `"\n"` for a line break, or `/name` for a glyph picked by name. */
  text: string;
}

/** One glyph a canvas text run shows, in the order its line shows them. */
export interface TextRunGlyph {
  /** The glyph shown; null for a character the font has no glyph for. */
  glyphId: GlyphId | null;
  name: string;
  /** The items it shows: one for most glyphs, several for a ligature. */
  itemIds: string[];
  line: number;
  /** Left edge of its advance box, in the run's units. */
  left: number;
  baseline: number;
  /** Where its outline is drawn: `left` and `baseline` plus a mark's attachment offset. */
  origin: { x: number; y: number };
  advance: number;
  /** Kerning with the next glyph, added after `advance`. */
  kern: number;
}

/** The Text mode caret, as positions between items: 0 is before the first item. */
export interface TextRunCaret {
  position: number;
  /** The selected positions, `start` to `end`; equal when nothing is selected. */
  selection: { start: number; end: number };
  /** Where the caret is drawn, in the run's units. */
  x: number;
  y: number;
}

/** The canvas text run as it shows now. */
export interface TextRunView {
  items: TextRunItem[];
  glyphs: TextRunGlyph[];
  /** The run's total advance, in its units. */
  advance: number;
  /** Each line's baseline, top line first. */
  baselines: number[];
  /** The item whose glyph is open on the canvas, showing its outline; null when none is. */
  openItemId: string | null;
  /**
   * The name of the glyph open on the canvas: the item's glyph, or one part
   * of it, such as a dot, when the font draws the item with several.
   */
  openGlyph: string | null;
  /** The item whose glyph is being edited in place, its points editable; null when none is. */
  editedItemId: string | null;
  /** The item under the pointer, highlighted as text; null when none is. */
  hoveredItemId: string | null;
  /** The caret while Text mode shows one; null otherwise. */
  caret: TextRunCaret | null;
}

/** One glyph's side of a spacing gap. */
export interface SpacingGapSide {
  itemId: string;
  glyph: string;
  sidebearing: number;
  /** X of its outline's edge facing the gap. */
  edge: number;
}

/** The space between two neighbouring glyphs, or before or after a line. */
export interface SpacingGapView {
  left: SpacingGapSide | null;
  right: SpacingGapSide | null;
  /** End of the left glyph's advance box. */
  leftBoundary: number;
  /** Start of the right glyph's advance box; differs from `leftBoundary` by the kern. */
  rightBoundary: number;
  baseline: number;
  top: number;
  bottom: number;
}

/** One sidebearing the Spacing tool shows: a gap's left or right half. */
export interface SpacingHalfView {
  side: "left" | "right";
  /** `gap` when reached through its gap; `glyph` when drawn alone beside its glyph. */
  scope: "gap" | "glyph";
  gap: SpacingGapView;
}

/** What the Spacing tool shows. */
export interface SpacingToolView {
  hovered: SpacingHalfView | null;
  /** The half arrow keys nudge. */
  selected: SpacingHalfView | null;
  /** The half whose value field is open. */
  editing: SpacingHalfView | null;
  /** Every other place the hovered half's glyph shows the same sidebearing. */
  sameAsHovered: SpacingHalfView[];
  /** Whether the pointer is on the hovered half's value. */
  overValue: boolean;
  /** Whether a nudge hid the overlay until the pointer moves. */
  quiet: boolean;
}

/** One side of the kerning pair that applies between two glyphs. */
export interface KerningPairSideView {
  /** The glyph's name, or the group's name when the pair kerns a group. */
  name: string;
  group: boolean;
  /** Whether this side is locked to its glyph, an exception to its group. */
  locked: boolean;
  /** Whether the lock can be toggled: false for a glyph with no group on that side. */
  toggleable: boolean;
}

/** One kern the Kerning tool shows between two neighbouring glyphs. */
export interface KerningGapView {
  firstItemId: string;
  secondItemId: string;
  amount: number;
  /** X of the middle of the kern, in the run's units. */
  center: number;
  baseline: number;
  bottom: number;
  /** The pair an edit here changes; null where the location is interpolated. */
  pair: { first: KerningPairSideView; second: KerningPairSideView; amount: number } | null;
}

/** What the Kerning tool shows. */
export interface KerningToolView {
  hovered: KerningGapView | null;
  /** The kern arrow keys nudge, which the sidebar shows. */
  selected: KerningGapView | null;
  /** The kern whose value field is open. */
  editing: KerningGapView | null;
  /** Every other place in the text the hovered kern applies to. */
  sameAsHovered: KerningGapView[];
}
