import type {
  ContourId,
  PointId,
  AnchorId,
  AxisId,
  AxisLabelId,
  AxisMappingId,
  ComponentId,
  GuidelineId,
  GlyphId,
  GlyphName,
  LayerId,
  MetricId,
  NamedInstanceId,
  SourceId,
  Unicode,
} from "@shift/types";
export declare class Bridge {
  constructor()
  createUntitledWorkspace(storePath: string, options?: NapiNewWorkspace | undefined | null): void
  exportWorkspace(request: NapiFontExportRequest): Promise<NapiFontExportResult>
  documentState(): NapiDocumentState
  inspectDocument(path: string): NapiDocumentIdentity
  closeWorkspace(): void
  openDocument(path: string, recoveryPath: string): void
  openWorkspace(path: string, storePath: string): void
  openFontSource(path: string): NapiFontSnapshot
  closeFontSource(): void
  setWorkspaceId(workspaceId: string): NapiDocumentState
  saveWorkspace(): NapiDocumentState
  saveWorkspaceAsDocument(path: string, recoveryPath: string): NapiDocumentState
  discardWorkspaceChanges(): NapiDocumentState
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
  /**
   * Returns compact glyph projections without resolving a location.
   *
   * Missing glyph identities and glyphs without authored shapes are omitted.
   * The projections retain compatible interpolation and exact-source shapes so a
   * renderer can evaluate design-location changes without further IPC.
   */
  getGlyphProjections(glyphIds: Array<GlyphId>): Array<NapiGlyphProjection>
  /**
   * Location-resolved glyph previews: one svg path and advance per glyph.
   *
   * `location` is an internal authoring location; external axis mappings must
   * be evaluated first (see `map_location`). Components and interpolation
   * resolve at that location with shared component work across the batch.
   * Missing glyph identities are omitted. No editable structure crosses the
   * boundary, so the payload stays orders of magnitude lighter than
   * `get_glyph_snapshots`.
   */
  getGlyphPreviews(glyphIds: Array<GlyphId>, location: NapiLocation): Array<NapiGlyphPreview>
  /**
   * Builds one complete authored Slug generation without resolving a location.
   *
   * The returned metadata is small enough for the ordinary sync lane. Packed
   * geometry remains native until `stream_slug_atlas` emits bounded chunks.
   */
  prepareSlugAtlas(alignment: number): NapiSlugAtlas
  /** Returns the durable authored revision used to address disposable cached atlas pages. */
  slugAtlasCacheRevision(): string
  /**
   * Builds one ordered root-glyph page plus its transitive component geometry.
   *
   * The page uses the same packed layout as a complete atlas, but excludes
   * unrelated roots so the renderer can make its viewport resident first.
   */
  prepareSlugAtlasPage(glyphIds: Array<GlyphId>, alignment: number): NapiSlugAtlas
  /**
   * Streams the prepared generation with native Web Stream backpressure.
   *
   * A capacity-one channel bounds temporary memory to one upload chunk. The
   * authored atlas moves to the producer thread and is dropped when the stream
   * completes, so GPU residency retains no second atlas-sized CPU copy.
   */
  streamSlugAtlas(generation: number, maximumLength: number): ReadableStream<Buffer>
  /** Streams one prepared page with the complete-atlas backpressure contract. */
  streamSlugAtlasPage(generation: number, maximumLength: number): ReadableStream<Buffer>
  /** Releases a prepared generation after adapter rejection or initialization failure. */
  discardSlugAtlas(generation: number): void
  /** Releases one rejected prepared page. */
  discardSlugAtlasPage(generation: number): void
  /** Reads one location-independent source glyph and its complete component closure. */
  readFontSourceGlyph(glyphId: GlyphId): Array<NapiGlyphSnapshot>
  /** Builds one source-neutral catalog page through the active format adapter. */
  prepareSourceAtlasPage(pageIndex: number, glyphIds: Array<GlyphId>, coordinates: Array<number>, alignment: number): NapiCatalogAtlasPage
  /** Streams one prepared source page through the same bounded atlas lane. */
  streamSourceAtlasPage(generation: number, maximumLength: number): ReadableStream<Buffer>
  /** Releases a rejected source page and its retained weight descriptor. */
  discardSourceAtlasPage(pageIndex: number, generation: number): void
  /** Evaluates every resident page's small weight buffer at one source location. */
  sourceAtlasWeights(coordinates: Array<number>): Array<NapiCatalogAtlasWeights>
  isVariable(): boolean
  getAxes(): Array<NapiAxis>
  getAxisMappings(): Array<NapiAxisMapping>
  getAxisMappingBases(): Array<NapiAxisMappingBasis>
  getMetricDefinitions(): Array<NapiMetricDefinition>
  getNamedInstances(): Array<NapiNamedInstance>
  /** Returns the precomputed source-metric interpolation model for this font. */
  getSourceMetricsInterpolation(): NapiSourceMetricsInterpolationSnapshot | null
  mapLocation(location: NapiLocation): NapiLocation
  getSources(): Array<NapiSource>
}

export interface NapiDocumentIdentity {
  documentId: string
  canonicalPath: string
}

export interface NapiDocumentState {
  sourceKind: string
  documentId?: string
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
  /** Present when the apply produced any font-level replacement collections. */
  next?: NapiFontReplacement
  /** Stable ids: references survive renames without re-indexing. */
  dependents: Array<GlyphId>
}

export interface NapiAxis {
  id: AxisId
  tag: string
  name: string
  role: NapiAxisRole
  axisType: NapiAxisType
  minimum?: number
  default: number
  maximum?: number
  values?: Array<number>
  labels: Array<NapiAxisLabel>
  hidden: boolean
}

export interface NapiAxisLabel {
  id: AxisLabelId
  name: string
  value: number
  minimum?: number
  maximum?: number
  linkedValue?: number
  elidable: boolean
}

export interface NapiAxisMapping {
  id: AxisMappingId
  name: string
  description?: string
  inputs: Array<AxisId>
  outputs: Array<AxisId>
  points: Array<NapiAxisMappingPoint>
}

export interface NapiAxisMappingBasis {
  mappingId: AxisMappingId
  inputAxisIds: Array<AxisId>
  outputAxisIds: Array<AxisId>
  basis: NapiVariationBasis
}

export interface NapiAxisMappingPoint {
  description?: string
  input: NapiLocation
  output: NapiLocation
}

export declare const enum NapiAxisRole {
  External = 'external',
  Internal = 'internal'
}

export declare const enum NapiAxisType {
  Continuous = 'continuous',
  Discrete = 'discrete'
}

export interface NapiBooleanOpIntent {
  layerId: LayerId
  contourIdA: ContourId
  contourIdB: ContourId
  /** "union" | "subtract" | "intersect" | "difference" */
  operation: string
}

export interface NapiCatalogAtlasGlyph {
  glyphId: GlyphId
  defaultGlyph: number
  exactSources: Array<NapiSlugExactSource>
}

export interface NapiCatalogAtlasPage {
  generation: number
  pageIndex: number
  bandCount: number
  weightCount: number
  layout: NapiSlugLayout
  previewExtents: NapiSlugPreviewExtents
  glyphs: Array<NapiCatalogAtlasGlyph>
  weights: Array<number>
  atlasGlyphCount: number
  curveCount: number
  componentCount: number
}

export interface NapiCatalogAtlasWeights {
  pageIndex: number
  weights: Array<number>
}

export interface NapiCatalogAxis {
  index: number
  tag: string
  name: string
  hidden: boolean
  axisType: string
  minimum?: number
  default: number
  maximum?: number
  values: Array<number>
}

export interface NapiCatalogMetrics {
  unitsPerEm: number
  ascender: number
  descender: number
  lineGap: number
}

/** Creates one glyph layer by copying another layer's shape with fresh internal ids. */
export interface NapiCloneGlyphLayerIntent {
  layerId: LayerId
  glyphId: GlyphId
  sourceId: SourceId
  fromLayerId: LayerId
}

export interface NapiComponentAnchorAttachment {
  source: NapiComponentAnchorReference
  target: NapiComponentAnchorReference
}

export interface NapiComponentAnchorReference {
  componentPath: Array<ComponentId>
  glyphId: GlyphId
  anchorId: AnchorId
}

export interface NapiComponentData {
  id: ComponentId
  baseGlyphId: GlyphId
  baseGlyphName: GlyphName
}

export interface NapiComponentGlyph {
  parentGlyphId: GlyphId
  componentId: ComponentId
  componentIndex: number
  baseGlyphId: GlyphId
  parentPath: Array<ComponentId>
  componentPath: Array<ComponentId>
  attachment?: NapiComponentAnchorAttachment
}

export declare const enum NapiComponentTransformKind {
  Decomposed = 'decomposed',
  Affine = 'affine'
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
  axis: NapiAxis
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

/** Creates an authored named instance with client-minted stable identity. */
export interface NapiCreateNamedInstanceIntent {
  instance: NapiNamedInstance
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

/** Deletes an authored named instance without changing sources or geometry. */
export interface NapiDeleteNamedInstanceIntent {
  instanceId: NamedInstanceId
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
   * Font-level kinds additionally include metadata replacement, axis
   * create/update/delete, mapping replacement, named-instance
   * create/update/delete, source create/delete, and glyph or layer creation.
   * Every kind shares the same apply path; one set is one undo step.
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
  updateFontMetadata?: NapiUpdateFontMetadataIntent
  createAxis?: NapiCreateAxisIntent
  updateAxis?: NapiUpdateAxisIntent
  deleteAxis?: NapiDeleteAxisIntent
  setAxisMappings?: NapiSetAxisMappingsIntent
  setMetricDefinitions?: NapiSetMetricDefinitionsIntent
  createNamedInstance?: NapiCreateNamedInstanceIntent
  updateNamedInstance?: NapiUpdateNamedInstanceIntent
  deleteNamedInstance?: NapiDeleteNamedInstanceIntent
  createSource?: NapiCreateSourceIntent
  updateSource?: NapiUpdateSourceIntent
  deleteSource?: NapiDeleteSourceIntent
  createGlyphLayer?: NapiCreateGlyphLayerIntent
  cloneGlyphLayer?: NapiCloneGlyphLayerIntent
  materializeGlyphLayer?: NapiMaterializeGlyphLayerIntent
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
}

/**
 * Selective replacement-grade font collections produced by one apply.
 *
 * Every present collection is complete. An absent collection was untouched;
 * it must be retained from the renderer's current workspace snapshot.
 */
export interface NapiFontReplacement {
  /** Complete authored metadata when font metadata changed; absent otherwise. */
  metadata?: NapiFontMetadata
  /** Full records list when glyph identity changed; absent when untouched. */
  glyphs?: Array<NapiGlyphRecord>
  /** Full axes list when font-level axis structure changed; absent otherwise. */
  axes?: Array<NapiAxis>
  /** Full mapping list when font-level axis mappings changed; absent otherwise. */
  axisMappings?: Array<NapiAxisMapping>
  /** Rust-compiled mapping bases when axes or mappings changed; absent otherwise. */
  axisMappingBases?: Array<NapiAxisMappingBasis>
  /** Full font-owned metric definitions when their identity or order changed. */
  metricDefinitions?: Array<NapiMetricDefinition>
  /** Refreshed source-metric interpolation model when any of its inputs changed. */
  sourceMetricsInterpolation?: NapiSourceMetricsInterpolationReplacement
  /** Full authored product-preset list when named instances changed. */
  namedInstances?: Array<NapiNamedInstance>
  /**
   * Full sources list when font-level source structure changed (createAxis
   * reshapes locations, createSource adds one); absent otherwise.
   */
  sources?: Array<NapiSource>
}

export interface NapiFontSnapshot {
  metadata: NapiFontMetadata
  metrics: NapiFontMetrics
  metricDefinitions: Array<NapiMetricDefinition>
  sourceMetricsInterpolation?: NapiSourceMetricsInterpolationSnapshot
  glyphs: Array<NapiGlyphEntry>
  sources: Array<NapiSource>
  axes: Array<NapiAxis>
  axisMappings: Array<NapiAxisMapping>
  axisMappingBases: Array<NapiAxisMappingBasis>
  namedInstances: Array<NapiNamedInstance>
}

export interface NapiGlyphChangedEntities {
  pointIds: Array<PointId>
  contourIds: Array<ContourId>
  anchorIds: Array<AnchorId>
  guidelineIds: Array<GuidelineId>
  componentIds: Array<ComponentId>
}

export interface NapiGlyphComponents {
  rootGlyphId: GlyphId
  components: Array<NapiComponentGlyph>
}

export interface NapiGlyphEntry {
  id: GlyphId
  name: string
  unicodes: Array<number>
}

export interface NapiGlyphInterpolation {
  basis: NapiInterpolationBasis
  sources: Array<NapiGlyphSourceValues>
}

export interface NapiGlyphLayerRecord {
  id: LayerId
  sourceId: SourceId
}

export interface NapiGlyphLayerShape {
  structure: NapiGlyphStructure
  values: Float64Array
  componentTransformKind: NapiComponentTransformKind
}

export interface NapiGlyphLayerSnapshot {
  glyphId: GlyphId
  sourceId: SourceId
  state: NapiGlyphState
}

/**
 * Location-resolved drawable preview: one svg path and advance per glyph,
 * with no editable structure crossing the boundary.
 */
export interface NapiGlyphPreview {
  glyphId: GlyphId
  svgPath: string
  xAdvance: number
}

export interface NapiGlyphProjection {
  glyphId: GlyphId
  fallback: NapiGlyphLayerShape
  interpolation?: NapiGlyphInterpolation
  variation?: NapiGlyphVariation
  exactSourceShapes: Array<NapiGlyphSourceShape>
  components: NapiGlyphComponents
  exactSourceComponents: Array<NapiGlyphSourceComponents>
  componentGlyphIds: Array<GlyphId>
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
  projection?: NapiGlyphProjection
  layers: Array<NapiGlyphLayerSnapshot>
}

export interface NapiGlyphSnapshotRequest {
  glyphId: GlyphId
}

export interface NapiGlyphSourceComponents {
  sourceId: SourceId
  components: NapiGlyphComponents
}

export interface NapiGlyphSourceShape {
  sourceId: SourceId
  shape: NapiGlyphLayerShape
}

export interface NapiGlyphSourceValues {
  sourceId: SourceId
  values: Float64Array
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

export interface NapiGlyphVariation {
  basis: NapiVariationBasis
}

export interface NapiInterpolationBasis {
  sourceIds: Array<SourceId>
  basis: NapiVariationBasis
}

export interface NapiInterpolationSupport {
  axisId: AxisId
  lower: number
  peak: number
  upper: number
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

/** Creates one sparse layer from resolved values at a design-space location. */
export interface NapiMaterializeGlyphLayerIntent {
  layerId: LayerId
  glyphId: GlyphId
  sourceId: SourceId
  fromLayerId: LayerId
  /** Numeric state ordered like `GlyphState.values`. */
  values: Float64Array
}

export interface NapiMetricDefinition {
  id: MetricId
  kind: NapiMetricKind
  name: string
}

export declare const enum NapiMetricKind {
  Ascender = 'ascender',
  CapHeight = 'capHeight',
  XHeight = 'xHeight',
  Baseline = 'baseline',
  Descender = 'descender',
  Custom = 'custom'
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

/** NAPI projection of one explicit named product preset. */
export interface NapiNamedInstance {
  id: NamedInstanceId
  name: string
  location: NapiLocation
  postscriptName?: string
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
  OffCurve = 'offCurve',
  QCurve = 'qCurve'
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

export interface NapiSetAxisMappingsIntent {
  mappings: Array<NapiAxisMapping>
}

export interface NapiSetContourClosedIntent {
  layerId: LayerId
  contourId: ContourId
  closed: boolean
}

export interface NapiSetMetricDefinitionsIntent {
  definitions: Array<NapiMetricDefinition>
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

export interface NapiSlugAtlas {
  generation: number
  bandCount: number
  weightCount: number
  layout: NapiSlugLayout
  previewExtents: NapiSlugPreviewExtents
  glyphs: Array<NapiSlugGlyph>
  weightSets: Array<NapiSlugWeightSet>
  atlasGlyphCount: number
  curveCount: number
  componentCount: number
}

export interface NapiSlugExactSource {
  sourceId: SourceId
  glyphIndex: number
}

export interface NapiSlugGlyph {
  glyphId: GlyphId
  defaultGlyph: number
  exactSources: Array<NapiSlugExactSource>
}

export interface NapiSlugLayout {
  baseCurves: NapiSlugSection
  curveDeltas: NapiSlugSection
  sparseDeltas: NapiSlugSection
  glyphs: NapiSlugSection
  sources: NapiSlugSection
  sourceAdvances: NapiSlugSection
  componentGlyphs: NapiSlugSection
  componentParts: NapiSlugSection
  components: NapiSlugSection
  componentSources: NapiSlugSection
  anchorSources: NapiSlugSection
  lineBits: NapiSlugSection
  totalLength: number
}

export interface NapiSlugPreviewExtents {
  horizontal: number
  minimumY: number
  maximumY: number
}

export interface NapiSlugSection {
  offset: number
  length: number
}

export interface NapiSlugWeightSet {
  basis: NapiInterpolationBasis
  sourceWeightIndices: Array<number>
}

export interface NapiSource {
  id: SourceId
  name: string
  location: NapiLocation
  filename?: string
  metricValues: Array<NapiSourceMetricValue>
  italicAngle?: number
  lineGap?: number
  underlinePosition?: number
  underlineThickness?: number
}

export declare const enum NapiSourceMetricField {
  ItalicAngle = 'italicAngle',
  LineGap = 'lineGap',
  UnderlinePosition = 'underlinePosition',
  UnderlineThickness = 'underlineThickness'
}

/**
 * Replacement wrapper whose presence distinguishes "unchanged" from a
 * changed font that no longer has a valid source-metric variation model.
 */
export interface NapiSourceMetricsInterpolationReplacement {
  snapshot?: NapiSourceMetricsInterpolationSnapshot
}

export interface NapiSourceMetricsInterpolationSnapshot {
  metricIds: Array<MetricId>
  technicalFields: Array<NapiSourceMetricField>
  basis: NapiInterpolationBasis
  sources: Array<NapiSourceMetricValues>
}

export interface NapiSourceMetricValue {
  metricId: MetricId
  position: number
  overshoot: number
}

export interface NapiSourceMetricValues {
  sourceId: SourceId
  values: Float64Array
}

/** Affine move: O(selection-ids) wire instead of O(N) coords. */
export interface NapiTranslatePointsIntent {
  layerId: LayerId
  pointIds: Array<PointId>
  dx: number
  dy: number
}

export interface NapiUpdateAxisIntent {
  axis: NapiAxis
}

/** Replaces the complete authored metadata snapshot without changing metrics. */
export interface NapiUpdateFontMetadataIntent {
  /** Complete replacement snapshot; omitted optional fields are cleared. */
  metadata: NapiFontMetadata
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

/** Replaces an authored named instance while retaining its identity. */
export interface NapiUpdateNamedInstanceIntent {
  instance: NapiNamedInstance
}

export interface NapiUpdateSourceIntent {
  sourceId: SourceId
  name: string
  location: NapiLocation
  metricValues: Array<NapiSourceMetricValue>
  italicAngle?: number
  lineGap?: number
  underlinePosition?: number
  underlineThickness?: number
}

export interface NapiVariationBasis {
  deltas: Array<NapiVariationDelta>
}

export interface NapiVariationDelta {
  region: Array<NapiInterpolationSupport>
  values: Float64Array
}
