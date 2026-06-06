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
  createWorkspace(sourcePath: string, storePath: string, options?: NapiNewWorkspace | undefined | null): void
  openWorkspace(path: string, storePath: string): void
  saveWorkspace(): number
  saveWorkspaceAs(path: string): number
  exportWorkspace(request: NapiFontExportRequest): Promise<NapiFontExportResult>
  getMetadata(): NapiFontMetadata
  getMetrics(): NapiFontMetrics
  getGlyphCount(): number
  getGlyphs(): Array<NapiGlyphRecord>
  updateGlyphIdentity(fromName: GlyphName, name: GlyphName, unicodes: Array<Unicode>): void
  getGlyphState(glyphHandle: GlyphHandle, sourceId: SourceId): NapiGlyphState | null
  getGlyphVariationReport(glyphRef: GlyphHandle): NapiGlyphVariationReport | null
  getVariationReports(): Array<NapiGlyphVariationReport>
  isVariable(): boolean
  getAxes(): Array<NapiAxis>
  getSources(): Array<NapiSource>
  getPersistedVersion(): number
  isDirty(): boolean
  setXAdvance(glyphRef: GlyphLayerRef, width: number): NapiGlyphValueChange
  translateLayer(glyphRef: GlyphLayerRef, dx: number, dy: number): NapiGlyphValueChange
  addPoint(glyphRef: GlyphLayerRef, contourId: ContourId, x: number, y: number, pointType: NapiPointType, smooth: boolean): NapiGlyphStructureChange
  insertPointBefore(glyphRef: GlyphLayerRef, beforePointId: PointId, x: number, y: number, pointType: NapiPointType, smooth: boolean): NapiGlyphStructureChange
  addContour(glyphRef: GlyphLayerRef): NapiGlyphStructureChange
  openContour(glyphRef: GlyphLayerRef, contourId: ContourId): NapiGlyphStructureChange
  closeContour(glyphRef: GlyphLayerRef, contourId: ContourId): NapiGlyphStructureChange
  reverseContour(glyphRef: GlyphLayerRef, contourId: ContourId): NapiGlyphStructureChange
  applyBooleanOp(glyphRef: GlyphLayerRef, contourIdA: ContourId, contourIdB: ContourId, operation: string): NapiGlyphStructureChange
  removePoints(glyphRef: GlyphLayerRef, pointIds: Array<PointId>): NapiGlyphStructureChange
  toggleSmooth(glyphRef: GlyphLayerRef, pointId: PointId): NapiGlyphStructureChange
  /**
   * Bulk position sync. IDs use BigUint64Array to avoid lossy float packing.
   * Coords are interleaved [x0, y0, x1, y1, ...].
   */
  applyPositionPatch(glyphRef: GlyphLayerRef, pointIds?: BigUint64Array | undefined | null, pointCoords?: Float64Array | undefined | null, anchorIds?: BigUint64Array | undefined | null, anchorCoords?: Float64Array | undefined | null): void
  restoreState(glyphRef: GlyphLayerRef, structure: NapiGlyphStructure, values: Float64Array): NapiGlyphStructureChange
}

export interface GlyphHandle {
  name: GlyphName
  unicode?: Unicode
}

export interface GlyphLayerRef {
  glyphHandle: GlyphHandle
  sourceId: SourceId
}

export interface NapiFontExportRequest {
  path: string
  format: string
}

export interface NapiFontExportResult {
  path: string
  format: string
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

export interface NapiNewWorkspace {
  familyName?: string
  unitsPerEm?: number
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
  filename?: string
}
