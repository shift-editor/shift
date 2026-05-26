import type {
  ContourId,
  PointId,
  AnchorId,
  AxisId,
  ComponentId,
  GlyphId,
  GuidelineId,
  GlyphName,
  LayerId,
  SourceId,
  Unicode,
} from "@shift/types";

export type SourceReadiness =
  | "singleSource"
  | "ready"
  | "missingSourceLayers"
  | "interpolationIncompatible"
  | "missingSourceLayersAndInterpolationIncompatible";

export type OpenPreviewStatus =
  | "ready"
  | "readyWithCleanup"
  | "recoveryRequired"
  | "blockedByRecovery";

export type OpenAction =
  | "load"
  | "cleanupThenLoad"
  | "recoverThenLoad"
  | "block";

export type SavePreviewStatus =
  | "unchanged"
  | "ready"
  | "blockedByExternalChanges"
  | "blockedByStagedCommit";

export type SaveAction =
  | "nothingToSave"
  | "save"
  | "resolveExternalChanges"
  | "resolveStagedCommit";

export type SaveStatus = "unchanged" | "saved";

export type GlyphRemovalStrategy =
  | "direct"
  | "removeComponentUses";

export type MasterLayerWorkStatus =
  | "ready"
  | "missingLayers"
  | "hasInterpolationMismatches"
  | "missingLayersAndInterpolationMismatches";
export declare class Bridge {
  constructor()
  createFont(): void
  loadFont(path: string): void
  saveFont(path: string): Promise<number>
  exportFont(request: NapiFontExportRequest): Promise<NapiFontExportResult>
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
  applyPositionPatch(pointIds?: BigUint64Array | undefined | null, pointCoords?: Float64Array | undefined | null, anchorIds?: BigUint64Array | undefined | null, anchorCoords?: Float64Array | undefined | null): void
  restoreState(structure: NapiGlyphStructure, values: Float64Array): NapiGlyphStructureChange
}

export declare class ShiftSourceDocument {
  constructor()
  initializeSaved(path: string): void
  previewOpen(path: string): OpenPreview
  recoverAndOpen(path: string): OpenResult
  open(path: string): void
  fontInfo(): FontInfo
  glyphs(): Array<GlyphEntry>
  masterLayerWorklist(): MasterLayerWorklist
  updateFontInfo(familyName: string, unitsPerEm: number): EditImpact
  createGlyph(name: string, unicode: string | undefined | null, width: number): GlyphEdit
  renameGlyph(glyphId: GlyphId, name: GlyphName): GlyphEdit
  previewGlyphRemoval(glyphId: GlyphId): GlyphRemovalPreview
  removeGlyphAndComponentUses(glyphId: GlyphId): GlyphRemovalEdit
  createSource(name: string, weight: number): FontSourceEdit
  createGlyphSourceLayer(glyphId: GlyphId, sourceId: SourceId, width: number): GlyphEdit
  previewSave(path: string): SavePreview
  save(path: string): SaveResult
}

export interface EditImpact {
  revision: number
  changeCount: number
  canonicalPaths: Array<string>
  removedCanonicalPaths: Array<string>
  derivedPaths: Array<string>
}

export interface FontInfo {
  familyName?: string
  styleName?: string
  unitsPerEm: number
}

export interface FontSourceEdit {
  impact: EditImpact
  sourceId: SourceId
  sourceName: string
  variableReadiness: SourceReadiness
  missingLayerCount: number
}

export interface GlyphComponentUser {
  glyphId: GlyphId
  glyphName: GlyphName
  componentCount: number
}

export interface GlyphEdit {
  impact: EditImpact
  glyphId: GlyphId
  glyphName: GlyphName
  variableReadiness: SourceReadiness
  missingLayerCount: number
}

export interface GlyphEntry {
  id: GlyphId
  name: GlyphName
  componentBaseGlyphNames: Array<GlyphName>
}

export interface GlyphHandle {
  name: GlyphName
  unicode?: Unicode
}

export interface GlyphRemovalEdit {
  impact: EditImpact
  glyphId: GlyphId
  glyphName: GlyphName
  removedComponentUseCount: number
  componentUsers: Array<GlyphComponentUser>
  variableReadiness: SourceReadiness
  missingLayerCount: number
}

export interface GlyphRemovalPreview {
  revision: number
  glyphId: GlyphId
  glyphName: GlyphName
  canRemoveDirectly: boolean
  requiresStrategy: boolean
  componentUseCount: number
  componentUserCount: number
  componentUsers: Array<GlyphComponentUser>
  validStrategies: Array<GlyphRemovalStrategy>
}

export interface MasterLayerWorkItem {
  sourceId: SourceId
  sourceName: string
  isDefaultSource: boolean
  status: MasterLayerWorkStatus
  missingLayerCount: number
  missingGlyphLayers: Array<MissingMasterLayer>
  interpolationMismatchIssueCount: number
  interpolationIncompatibleGlyphCount: number
}

export interface MasterLayerWorklist {
  revision: number
  variableReadiness: SourceReadiness
  sourceCount: number
  glyphCount: number
  sourceNeedingWorkCount: number
  missingLayerCount: number
  interpolationMismatchIssueCount: number
  items: Array<MasterLayerWorkItem>
}

export interface MissingMasterLayer {
  glyphId: GlyphId
  glyphName: GlyphName
  sourceId: SourceId
}

export interface NapiAnchorData {
  id: AnchorId
  name?: string
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

export interface NapiFontExportRequest {
  path: string
  format: string
}

export interface NapiFontExportResult {
  path: string
  format: string
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

export interface OpenPreview {
  status: OpenPreviewStatus
  primaryAction: OpenAction
  stagedRecoveryCount: number
  resumeRecoveryCount: number
  cleanupRecoveryCount: number
  blockedRecoveryCount: number
  unrecoverableRecoveryCount: number
  pendingPathCount: number
  appliedPathCount: number
  divergedPathCount: number
  issueCount: number
}

export interface OpenResult {
  recoveredTransactionCount: number
  glyphCount: number
  sourceCount: number
}

export interface SavePreview {
  revision: number
  status: SavePreviewStatus
  primaryAction: SaveAction
  changeCount: number
  canonicalPathCount: number
  removedCanonicalPathCount: number
  derivedPathCount: number
  conflictCount: number
  stagedRecoveryCount: number
}

export interface SaveResult {
  revision: number
  status: SaveStatus
  changeCount: number
  canonicalPathCount: number
  removedCanonicalPathCount: number
  derivedPathCount: number
  conflictCount: number
  stagedRecoveryCount: number
}
export interface NapiAnchorData {
  id: AnchorId
  name?: string
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
