import type {
  ContourId,
  PointId,
  AnchorId,
  ComponentId,
  GuidelineId,
  GlyphId,
  GlyphName,
  LayerId,
  SourceId,
  Unicode,
} from "@shift/types";
export declare class Bridge {
  constructor()
  createUntitledWorkspace(storePath: string, options?: NapiNewWorkspace | undefined | null): void
  closeWorkspace(): void
  saveWorkspace(): number
  saveWorkspaceAs(path: string): number
  exportWorkspace(request: NapiFontExportRequest): Promise<NapiFontExportResult>
  getMetadata(): NapiFontMetadata
  getMetrics(): NapiFontMetrics
  getGlyphCount(): number
  getGlyphs(): Array<NapiGlyphRecord>
  updateGlyphIdentity(fromName: GlyphName, name: GlyphName, unicodes: Array<Unicode>): void
  /**
   * Applies one intent set as a single atomic workspace apply.
   *
   * Editing kinds decode through `map_intent` into `Font::apply_intents`;
   * `createGlyph` keeps its workspace-verb path until font-level verbs get
   * intent homes (CS4 tail). Sets must be homogeneous: font-level and
   * editing intents never share a tick.
   */
  apply(intents: Array<NapiFontIntent>, label?: string | undefined | null): NapiAppliedChange
  /**
   * Replays the most recent ledger entry's pre states; `null` when the
   * undo stack is empty.
   */
  undo(): NapiAppliedChange | null
  /**
   * Replays the most recent undone entry's post states; `null` when the
   * redo stack is empty.
   */
  redo(): NapiAppliedChange | null
  /**
   * Id-addressed glyph state: the stable-identity twin of
   * `get_glyph_state`. References survive renames; no name lookup.
   */
  getGlyph(glyphId: GlyphId, sourceId: SourceId): NapiGlyphState | null
  getGlyphState(glyphHandle: GlyphHandle, sourceId: SourceId): NapiGlyphState | null
  isVariable(): boolean
  getAxes(): Array<NapiAxis>
  getSources(): Array<NapiSource>
  getPersistedVersion(): number
  isDirty(): boolean
  createGlyph(name: GlyphName, unicodes: Array<Unicode>): GlyphId
  createGlyphLayer(glyphId: GlyphId, sourceId: SourceId): LayerId
  setXAdvance(layerId: LayerId, width: number): NapiGlyphValueChange
  translateLayer(layerId: LayerId, dx: number, dy: number): NapiGlyphValueChange
  addPoint(layerId: LayerId, contourId: ContourId, x: number, y: number, pointType: NapiPointType, smooth: boolean): NapiGlyphStructureChange
  insertPointBefore(layerId: LayerId, beforePointId: PointId, x: number, y: number, pointType: NapiPointType, smooth: boolean): NapiGlyphStructureChange
  addContour(layerId: LayerId): NapiGlyphStructureChange
  openContour(layerId: LayerId, contourId: ContourId): NapiGlyphStructureChange
  closeContour(layerId: LayerId, contourId: ContourId): NapiGlyphStructureChange
  reverseContour(layerId: LayerId, contourId: ContourId): NapiGlyphStructureChange
  applyBooleanOp(layerId: LayerId, contourIdA: ContourId, contourIdB: ContourId, operation: string): NapiGlyphStructureChange
  removePoints(layerId: LayerId, pointIds: Array<PointId>): NapiGlyphStructureChange
  toggleSmooth(layerId: LayerId, pointId: PointId): NapiGlyphStructureChange
  /**
   * Bulk position sync. IDs are stable typed strings from the current glyph state.
   * Coords are interleaved [x0, y0, x1, y1, ...].
   */
  applyPositionPatch(layerId: LayerId, pointIds?: Array<PointId> | null, pointCoords?: Float64Array | undefined | null, anchorIds?: Array<AnchorId> | null, anchorCoords?: Float64Array | undefined | null): void
  restoreState(layerId: LayerId, structure: NapiGlyphStructure, values: Float64Array): NapiGlyphStructureChange
}

export interface GlyphHandle {
  name: GlyphName
  unicode?: Unicode
}

export interface NapiFontExportRequest {
  path: string
  format: string
}

export interface NapiFontExportResult {
  path: string
  format: string
}

export interface NapiNewWorkspace {
  familyName?: string
  unitsPerEm?: number
}
export interface NapiAddContourIntent {
  layerId: LayerId
  contourId: ContourId
  closed: boolean
}

export interface NapiAddPointsIntent {
  layerId: LayerId
  /** Absent when `before` carries the anchor; Rust derives the contour. */
  contourId?: ContourId
  /** Insert before this point; append when absent. */
  before?: PointId
  points: Array<NapiPointSeed>
}

export interface NapiAnchorData {
  id: AnchorId
  name?: string
}

/** Pure-state response to `apply`: no change records cross to the renderer. */
export interface NapiAppliedChange {
  layers: Array<NapiLayerReplaced>
  /** Full records list when glyph identity changed; absent when untouched. */
  glyphs?: Array<NapiGlyphRecord>
  /** Stable ids: references survive renames without re-indexing. */
  dependents: Array<GlyphId>
}

export interface NapiAxis {
  tag: string
  name: string
  minimum: number
  default: number
  maximum: number
  hidden: boolean
}

export interface NapiAxisTent {
  axisTag: string
  lower: number
  peak: number
  upper: number
}

export interface NapiBooleanOpIntent {
  layerId: LayerId
  contourIdA: ContourId
  contourIdB: ContourId
  /** "union" | "subtract" | "intersect" | "difference" */
  operation: string
}

export interface NapiComponentData {
  id: ComponentId
  baseGlyphName: GlyphName
}

export interface NapiContourData {
  id: ContourId
  points: Array<NapiPointData>
  closed: boolean
}

/**
 * CS0 walking-skeleton intent. A stringly union covering exactly the two
 * skeleton kinds; CS1 replaces this with per-variant intent structs.
 */
export interface NapiFontIntent {
  /**
   * Discriminator naming the populated payload field. Editing kinds:
   * "addPoints" | "addContour" | "setContourClosed" | "movePoints" |
   * "setPointSmooth" | "removePoints" | "reverseContour" |
   * "translatePoints" | "setXAdvance" | "applyBooleanOp".
   * Skeleton leftover until font-level verbs land: "createGlyph".
   */
  kind: string
  addPoints?: NapiAddPointsIntent
  addContour?: NapiAddContourIntent
  setContourClosed?: NapiSetContourClosedIntent
  movePoints?: NapiMovePointsIntent
  setPointSmooth?: NapiSetPointSmoothIntent
  removePoints?: NapiRemovePointsIntent
  reverseContour?: NapiReverseContourIntent
  translatePoints?: NapiTranslatePointsIntent
  setXAdvance?: NapiSetXAdvanceIntent
  applyBooleanOp?: NapiBooleanOpIntent
  name?: GlyphName
  unicodes?: Array<Unicode>
}

export interface NapiFontMetadata {
  familyName?: string
  styleName?: string
  versionMajor?: number
  versionMinor?: number
  copyright?: string
  trademark?: string
  designer?: string
  designerUrl?: string
  manufacturer?: string
  manufacturerUrl?: string
  license?: string
  licenseUrl?: string
  description?: string
  note?: string
}

export interface NapiFontMetrics {
  unitsPerEm: number
  ascender: number
  descender: number
  capHeight?: number
  xHeight?: number
  lineGap?: number
  italicAngle?: number
  underlinePosition?: number
  underlineThickness?: number
}

export interface NapiGlyphChangedEntities {
  pointIds: Array<PointId>
  contourIds: Array<ContourId>
  anchorIds: Array<AnchorId>
  guidelineIds: Array<GuidelineId>
  componentIds: Array<ComponentId>
}

export interface NapiGlyphMaster {
  sourceId: SourceId
  sourceName: string
  isDefaultSource: boolean
  location: NapiLocation
  structure: NapiGlyphStructure
  values: Float64Array
}

export interface NapiGlyphRecord {
  id: GlyphId
  name: GlyphName
  unicodes: Array<Unicode>
  componentBaseGlyphNames: Array<GlyphName>
}

export interface NapiGlyphState {
  layerId: LayerId
  structure: NapiGlyphStructure
  /** Numeric glyph state ordered to match `GlyphStructure`. */
  values: Float64Array
  variationData?: NapiGlyphVariationData
}

export interface NapiGlyphStructure {
  contours: Array<NapiContourData>
  anchors: Array<NapiAnchorData>
  components: Array<NapiComponentData>
}

export interface NapiGlyphStructureChange {
  structure: NapiGlyphStructure
  values: Float64Array
  changed: NapiGlyphChangedEntities
}

export interface NapiGlyphValueChange {
  values: Float64Array
  changed: NapiGlyphChangedEntities
}

export interface NapiGlyphVariationData {
  /** One entry per region. Inner = tents on the axes the region depends on. */
  regions: Array<Array<NapiAxisTent>>
  /** Deltas are flattened in `GlyphState::values` order. */
  deltas: Array<Float64Array>
}

/**
 * Replace-grade state for one touched layer; the renderer folds by
 * substitution, never by interpreting changes.
 */
export interface NapiLayerReplaced {
  layerId: LayerId
  /** Present only when the layer's structure changed. */
  structure?: NapiGlyphStructure
  values: Float64Array
  changed: NapiGlyphChangedEntities
}

export interface NapiLocation {
  values: Record<string, number>
}

export interface NapiMovePointsIntent {
  layerId: LayerId
  pointIds: Array<PointId>
  /** Interleaved absolute coordinates: x0, y0, x1, y1, … */
  coords: Array<number>
}

export interface NapiPointData {
  id: PointId
  pointType: NapiPointType
  smooth: boolean
}

/**
 * A point to create, carrying its caller-minted id (decision 6: ids are
 * client-minted so verbs return identity synchronously).
 */
export interface NapiPointSeed {
  id: PointId
  x: number
  y: number
  pointType: NapiPointType
  smooth: boolean
}

export declare const enum NapiPointType {
  OnCurve = 'onCurve',
  OffCurve = 'offCurve'
}

export interface NapiRemovePointsIntent {
  layerId: LayerId
  pointIds: Array<PointId>
}

export interface NapiReverseContourIntent {
  layerId: LayerId
  contourId: ContourId
}

export interface NapiSetContourClosedIntent {
  layerId: LayerId
  contourId: ContourId
  closed: boolean
}

export interface NapiSetPointSmoothIntent {
  layerId: LayerId
  pointId: PointId
  smooth: boolean
}

export interface NapiSetXAdvanceIntent {
  layerId: LayerId
  width: number
}

export interface NapiSource {
  id: SourceId
  name: string
  location: NapiLocation
  filename?: string
}

/** Affine move: O(selection-ids) wire instead of O(N) coords. */
export interface NapiTranslatePointsIntent {
  layerId: LayerId
  pointIds: Array<PointId>
  dx: number
  dy: number
}
