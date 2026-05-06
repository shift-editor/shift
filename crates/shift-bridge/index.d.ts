import type {
  ContourId,
  PointId,
  AnchorId,
  ComponentId,
  GuidelineId,
  GlyphName,
  LayerId,
  SourceId,
  Unicode,
} from "@shift/types";
export declare class Bridge {
  constructor()
  loadFont(path: string): void
  saveFont(path: string): Promise<number>
  getMetadata(): NapiFontMetadata
  getMetrics(): NapiFontMetrics
  getGlyphCount(): number
  getGlyphs(): Array<NapiGlyphRecord>
  getGlyphState(glyphHandle: GlyphHandle, sourceId: SourceId): NapiGlyphState | null
  getGlyphVariationReport(glyphRef: GlyphHandle): NapiGlyphVariationReport | null
  getVariationReports(): Array<NapiGlyphVariationReport>
  isVariable(): boolean
  getAxes(): Array<NapiAxis>
  getSources(): Array<NapiSource>
  startEditSession(glyphHandle: GlyphHandle, sourceId: SourceId): void
  getPersistedVersion(): number
  isDirty(): boolean
  endEditSession(): void
  hasEditSession(): boolean
  getEditingUnicode(): Unicode | null
  getEditingGlyphName(): GlyphName | null
  getEditingSourceId(): SourceId | null
  setXAdvance(width: number): NapiGlyphValueChange
  translateLayer(dx: number, dy: number): NapiGlyphValueChange
  addPoint(contourId: ContourId, x: number, y: number, pointType: NapiPointType, smooth: boolean): NapiGlyphStructureChange
  insertPointBefore(beforePointId: PointId, x: number, y: number, pointType: NapiPointType, smooth: boolean): NapiGlyphStructureChange
  addContour(): NapiGlyphStructureChange
  openContour(contourId: ContourId): NapiGlyphStructureChange
  closeContour(contourId: ContourId): NapiGlyphStructureChange
  reverseContour(contourId: ContourId): NapiGlyphStructureChange
  applyBooleanOp(contourIdA: ContourId, contourIdB: ContourId, operation: string): NapiGlyphStructureChange
  removePoints(pointIds: Array<PointId>): NapiGlyphStructureChange
  toggleSmooth(pointId: PointId): NapiGlyphStructureChange
  /**
   * Bulk position sync. IDs use BigUint64Array to avoid lossy float packing.
   * Coords are interleaved [x0, y0, x1, y1, ...].
   */
  setPositions(pointIds?: BigUint64Array | undefined | null, pointCoords?: Float64Array | undefined | null, anchorIds?: BigUint64Array | undefined | null, anchorCoords?: Float64Array | undefined | null): NapiGlyphValueChange
  restoreState(structure: NapiGlyphStructure, values: Float64Array): NapiGlyphStructureChange
}

export interface GlyphHandle {
  name: GlyphName
  unicode?: Unicode
}

export interface NapiGlyphVariationDiagnostic {
  glyphName: GlyphName
  code: string
  severity: string
  source?: NapiGlyphVariationDiagnosticSource
  message: string
}

export interface NapiGlyphVariationDiagnosticSource {
  id: SourceId
  index: number
  name: string
}

export interface NapiGlyphVariationReport {
  glyphName: GlyphName
  status: string
  variationDataAvailable: boolean
  masterCount: number
  compatibleMasterCount: number
  skippedMasterCount: number
  diagnostics: Array<NapiGlyphVariationDiagnostic>
}
export interface NapiAnchorData {
  id: AnchorId
  name?: string
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

export interface NapiComponentData {
  id: ComponentId
  baseGlyphName: GlyphName
}

export interface NapiContourData {
  id: ContourId
  points: Array<NapiPointData>
  closed: boolean
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
  name: GlyphName
  unicodes: Array<Unicode>
  componentBaseGlyphNames: Array<GlyphName>
}

export interface NapiGlyphState {
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

export interface NapiLocation {
  values: Record<string, number>
}

export interface NapiPointData {
  id: PointId
  pointType: NapiPointType
  smooth: boolean
}

export declare const enum NapiPointType {
  OnCurve = 'onCurve',
  OffCurve = 'offCurve'
}

export interface NapiSource {
  id: SourceId
  name: string
  location: NapiLocation
  layerId: LayerId
  filename?: string
}
