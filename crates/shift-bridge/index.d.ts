import type {
  ContourId,
  PointId,
  AnchorId,
  AxisId,
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
  exportWorkspace(request: NapiFontExportRequest): Promise<NapiFontExportResult>
  documentState(): NapiDocumentState
  inspectPackage(path: string): NapiPackageIdentity
  inspectPackageDraft(storePath: string): NapiPackageDraft
  closeWorkspace(): void
  openWorkspace(path: string, storePath: string): void
  resumeWorkspaceForSource(storePath: string, sourcePath: string): void
  setDocumentId(documentId: string): NapiDocumentState
  saveWorkspace(): NapiDocumentState
  saveWorkspaceAs(path: string): NapiDocumentState
  getMetadata(): NapiFontMetadata
  getMetrics(): NapiFontMetrics
  getGlyphs(): Array<NapiGlyphRecord>
  /**
   * Applies one intent set as a single atomic workspace apply: every kind
   * — editing and create alike — decodes through `map_intent` into one
   * `FontWorkspace::apply` call. One call = one SQLite transaction = one
   * undo step, however many intents the set batches.
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
  /** Glyph-addressed snapshots for renderer-local synchronous font state. */
  getGlyphSnapshots(requests: Array<NapiGlyphSnapshotRequest>): Array<NapiGlyphSnapshot>
  isVariable(): boolean
  getAxes(): Array<NapiAxis>
  getSources(): Array<NapiSource>
}

export interface NapiDocumentState {
  sourceKind: string
  saveTarget?: string
  dirty: boolean
  needsSaveAs: boolean
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

export interface NapiPackageDraft {
  documentId?: string
  packageId: string
  sourcePath: string
  baseFingerprint: string
  dirty: boolean
}

export interface NapiPackageIdentity {
  packageId: string
  canonicalPath: string
  fingerprint: string
}
export interface NapiAddAnchorsIntent {
  layerId: LayerId
  anchors: Array<NapiAnchorSeed>
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

/**
 * An anchor to create, carrying its caller-minted id (decision 6: ids are
 * client-minted so verbs return identity synchronously).
 */
export interface NapiAnchorSeed {
  id: AnchorId
  name?: string
  x: number
  y: number
}

/** Pure-state response to `apply`: no change records cross to the renderer. */
export interface NapiAppliedChange {
  layers: Array<NapiLayerReplaced>
  /** Full records list when glyph identity changed; absent when untouched. */
  glyphs?: Array<NapiGlyphRecord>
  /** Full axes list when font-level axis structure changed; absent otherwise. */
  axes?: Array<NapiAxis>
  /**
   * Full sources list when font-level source structure changed (createAxis
   * reshapes locations, createSource adds one); absent otherwise.
   */
  sources?: Array<NapiSource>
  /** Stable ids: references survive renames without re-indexing. */
  dependents: Array<GlyphId>
}

export interface NapiAxis {
  id: AxisId
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

/** Creates one glyph layer by copying another layer's shape with fresh internal ids. */
export interface NapiCloneGlyphLayerIntent {
  layerId: LayerId
  glyphId: GlyphId
  sourceId: SourceId
  fromLayerId: LayerId
}

export interface NapiComponentData {
  id: ComponentId
  baseGlyphId: GlyphId
  baseGlyphName: GlyphName
}

export interface NapiContourData {
  id: ContourId
  points: Array<NapiPointData>
  closed: boolean
}

/**
 * Font-level axis creation. The axis id is client-minted; the tag is an
 * OpenType label and must be unique within the font.
 */
export interface NapiCreateAxisIntent {
  axisId: AxisId
  tag: string
  name: string
  min: number
  default: number
  max: number
  hidden: boolean
}

/**
 * Font-level glyph creation. The glyph id is client-minted (decision 6:
 * verbs return identity synchronously); Rust honors it and rejects
 * duplicates.
 */
export interface NapiCreateGlyphIntent {
  glyphId: GlyphId
  name: GlyphName
  unicodes: Array<Unicode>
}

/** Creates one sparse glyph layer at an existing source for an existing glyph. */
export interface NapiCreateGlyphLayerIntent {
  layerId: LayerId
  glyphId: GlyphId
  sourceId: SourceId
}

/**
 * Font-level source creation. The source id is client-minted so verbs can
 * return identity synchronously; Rust honors it and rejects duplicates.
 */
export interface NapiCreateSourceIntent {
  sourceId: SourceId
  name: string
  /** Axis id → design-space value for the new source. */
  location: NapiLocation
}

/** Font-level axis deletion. Removing an axis also reshapes source locations. */
export interface NapiDeleteAxisIntent {
  axisId: AxisId
}

/** Font-level source deletion. Removing a source also removes its glyph layers. */
export interface NapiDeleteSourceIntent {
  sourceId: SourceId
}

/**
 * CS0 walking-skeleton intent. A stringly union covering exactly the two
 * skeleton kinds; CS1 replaces this with per-variant intent structs.
 */
export interface NapiFontIntent {
  /**
   * Discriminator naming the populated payload field. Editing kinds:
   * "addPoints" | "addContour" | "setContourClosed" | "movePoints" |
   * "setPointSmooth" | "removePoints" | "addAnchors" | "moveAnchors" |
   * "removeAnchors" | "reverseContour" | "translatePoints" |
   * "setXAdvance" | "applyBooleanOp".
   * Create kinds: "createGlyph" | "createAxis" | "createSource" |
   * "createGlyphLayer" | "cloneGlyphLayer". Delete kinds: "deleteAxis" |
   * "deleteSource". Every kind shares the same apply path; one set = one undo step.
   */
  kind: string
  addPoints?: NapiAddPointsIntent
  addContour?: NapiAddContourIntent
  setContourClosed?: NapiSetContourClosedIntent
  movePoints?: NapiMovePointsIntent
  setPointSmooth?: NapiSetPointSmoothIntent
  removePoints?: NapiRemovePointsIntent
  addAnchors?: NapiAddAnchorsIntent
  moveAnchors?: NapiMoveAnchorsIntent
  removeAnchors?: NapiRemoveAnchorsIntent
  reverseContour?: NapiReverseContourIntent
  translatePoints?: NapiTranslatePointsIntent
  setXAdvance?: NapiSetXAdvanceIntent
  applyBooleanOp?: NapiBooleanOpIntent
  createGlyph?: NapiCreateGlyphIntent
  updateGlyph?: NapiUpdateGlyphIntent
  createAxis?: NapiCreateAxisIntent
  deleteAxis?: NapiDeleteAxisIntent
  createSource?: NapiCreateSourceIntent
  deleteSource?: NapiDeleteSourceIntent
  createGlyphLayer?: NapiCreateGlyphLayerIntent
  cloneGlyphLayer?: NapiCloneGlyphLayerIntent
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

export interface NapiGlyphLayerRecord {
  id: LayerId
  sourceId: SourceId
}

export interface NapiGlyphLayerSnapshot {
  glyphId: GlyphId
  sourceId: SourceId
  state: NapiGlyphState
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
  componentBaseGlyphIds: Array<GlyphId>
  layers: Array<NapiGlyphLayerRecord>
}

export interface NapiGlyphSnapshot {
  glyphId: GlyphId
  variationData?: NapiGlyphVariationData
  layers: Array<NapiGlyphLayerSnapshot>
}

export interface NapiGlyphSnapshotRequest {
  glyphId: GlyphId
}

export interface NapiGlyphState {
  layerId: LayerId
  structure: NapiGlyphStructure
  /** Numeric glyph state ordered to match `GlyphStructure`. */
  values: Float64Array
}

export interface NapiGlyphStructure {
  contours: Array<NapiContourData>
  anchors: Array<NapiAnchorData>
  components: Array<NapiComponentData>
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
  values: Record<AxisId, number>
}

export interface NapiMoveAnchorsIntent {
  layerId: LayerId
  anchorIds: Array<AnchorId>
  /** Interleaved absolute coordinates: x0, y0, x1, y1, … */
  coords: Array<number>
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

export interface NapiRemoveAnchorsIntent {
  layerId: LayerId
  anchorIds: Array<AnchorId>
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

/**
 * Font-level glyph update. The glyph id targets an existing committed glyph;
 * names are user-editable labels and are not stable identity.
 */
export interface NapiUpdateGlyphIntent {
  glyphId: GlyphId
  newName: GlyphName
  newUnicodes: Array<Unicode>
}
