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
  KerningGroupId,
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
  /**
   * Builds the thumbnail specimen for a font file, independent of any
   * document or preview this bridge holds.
   *
   * Resolves to `null` when the font draws nothing usable; rejects when the
   * file cannot be read or compiled.
   */
  fontFileSpecimen(path: string): Promise<NapiSpecimen | null>
  /**
   * Builds the thumbnail specimen from the open document's current state.
   *
   * Resolves to `null` when the font draws nothing usable; rejects when no
   * workspace is open or compilation fails.
   */
  documentSpecimen(): Promise<NapiSpecimen | null>
  documentState(): NapiDocumentState
  inspectDocument(path: string): NapiDocumentIdentity
  closeWorkspace(): void
  openDocument(path: string, recoveryPath: string): void
  openWorkspace(path: string, storePath: string): void
  resumeWorkspace(storePath: string): void
  openFontSource(path: string): NapiFontSnapshot
  closeFontSource(): void
  setWorkspaceId(workspaceId: string): NapiDocumentState
  saveWorkspace(): NapiDocumentState
  saveWorkspaceAsDocument(path: string, recoveryPath: string): NapiDocumentState
  discardWorkspaceChanges(): NapiDocumentState
  getMetadata(): FontMetadata
  getMetrics(): NapiFontMetrics
  /**
   * Lists glyph records whose layers are only those on [`Font::masters`], so every listed
   * layer's source is one [`Self::get_sources`] returns.
   */
  getGlyphs(): Array<NapiGlyphRecord>
  /**
   * Applies one intent set as a single atomic workspace apply: every kind
   * — editing and create alike — decodes into one
   * `FontWorkspace::apply` call. One call = one SQLite transaction = one
   * undo step, however many intents the set batches.
   */
  apply(intents: Array<FontIntent>, label?: string | undefined | null): NapiAppliedChange
  /**
   * Applies the most recent ledger entry's inverse changeset; `null` when
   * the undo stack is empty.
   */
  undo(): NapiAppliedChange | null
  /**
   * Reapplies the most recently undone changeset; `null` when the redo
   * stack is empty.
   */
  redo(): NapiAppliedChange | null
  /**
   * Persists a change set, as named MessagePack, that a session over this
   * font already applied, and returns its echo: the layers it touched, the
   * font-level and glyph records it changed, and the composites that depend
   * on them. Nothing is added to this workspace's undo ledger. `save_state`
   * claims where the change leaves the font; the store verifies a claim to
   * match the saved document before discarding unsaved edits.
   *
   * # Errors
   *
   * Fails when the bytes do not decode to a change set, when a `before` in it
   * does not match this font, or when the write fails; the font is then
   * unchanged.
   */
  persist(changeSet: Uint8Array, saveState: NapiSaveState): NapiAppliedChange
  /** Permanently removes every redo entry without changing font or dirty state. */
  discardRedo(): void
  /** Glyph-addressed snapshots for renderer-local synchronous font state. */
  getGlyphSnapshots(requests: Array<NapiGlyphSnapshotRequest>): Array<NapiGlyphSnapshot>
  /**
   * Reads exact authored layers by stable layer identity.
   *
   * Results preserve request order and contain accepted workspace state
   * only. Components are not resolved, so a layer with a broken component
   * reference remains readable.
   *
   * # Errors
   *
   * Returns an error when any identity is malformed or absent from the font.
   */
  readLayers(layerIds: Array<LayerId>): Array<NapiGlyphLayerSnapshot>
  /**
   * Reads exact authored layers with their composited geometry.
   *
   * Each root keeps its requested authored geometry; components resolve at
   * that layer's source through normal interpolation and fallback, and
   * cyclic branches are skipped. Results preserve request order and do not
   * publish renderer models.
   *
   * # Errors
   *
   * Returns an error when any identity is malformed or absent, a component
   * cannot resolve, or referenced interpolation is incompatible.
   */
  resolveLayers(layerIds: Array<LayerId>): Array<NapiLayerRead>
  /**
   * Derives entity mappings and structural diagnostics between two layers.
   *
   * Both layers must belong to the same glyph. The read acquires that glyph's
   * authored layers before matching, so sparse workspace residency cannot
   * produce an incomplete result. Missing layers and cross-glyph requests are
   * rejected rather than represented as compatibility differences.
   */
  getLayerMatch(referenceLayerId: LayerId, targetLayerId: LayerId): NapiLayerMatch
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
  getGlyphPreviews(glyphIds: Array<GlyphId>, location: Location): Array<NapiGlyphPreview>
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
  getAxes(): Array<Axis>
  getAxisMappings(): Array<AxisMapping>
  getAxisMappingBases(): Array<NapiAxisMappingBasis>
  getMetricDefinitions(): Array<MetricDefinition>
  /**
   * Returns the font's tracked Hyperglot language ids in authored order.
   *
   * `null` when the font lib has no tracked-language key, so the renderer
   * applies its own default; an empty array is an explicit empty list.
   */
  getLanguageIds(): Array<string> | null
  /**
   * Returns the font's kerning groups, per-source pairs, and the basis
   * kerning interpolates over.
   */
  getKerning(): NapiKerningSnapshot
  getNamedInstances(): Array<NamedInstance>
  /** Returns the precomputed source-metric interpolation model for this font. */
  getSourceMetricsInterpolation(): NapiSourceMetricsInterpolationSnapshot | null
  /**
   * Shapes a paragraph with the font's feature code, split into runs of one
   * script, each in its script's direction.
   *
   * Characters map through the live font's Unicode values and every
   * glyph's own advance is zero while shaping, so the result carries the
   * substituted glyphs, their clusters, and only what the feature code
   * positions. The caller adds live advances, kerning, and mark attachment.
   *
   * Feature code with errors shapes with the last version that compiled.
   * The shaping tables are rebuilt only when a font change since the last
   * call altered the glyph order, glyph categories, feature code, or axes.
   */
  shapeParagraph(request: NapiParagraphRequest): Array<NapiShapedRun>
  /**
   * Returns the compiled shaping tables, for the editor to shape with
   * itself, or `null` when they are still at `known_revision`. Compiles
   * them first if the font changed in a way they depend on: glyph order,
   * glyph categories, feature code, or axes.
   */
  shaperFont(knownRevision?: number | undefined | null): NapiShaperFont | null
  mapLocation(location: Location): Location
  getSources(): Array<NapiSource>
}

/** A read-only view of a workspace's store. */
export declare class LayerReader {
  /**
   * Reads a document together with its recovery overlay.
   *
   * # Errors
   *
   * Fails when either file cannot be opened read-only or the document is not a supported
   * Shift document.
   */
  static openDocument(documentPath: string, recoveryPath: string): LayerReader
  /**
   * Reads the working store behind an untitled or imported workspace.
   *
   * # Errors
   *
   * Fails when the store cannot be opened read-only.
   */
  static openWorkingStore(storePath: string): LayerReader
  /**
   * The font's metadata and its glyph and layer directory, every layer a
   * placeholder, as named MessagePack: what an engine session opens with.
   *
   * # Errors
   *
   * Fails when the directory cannot be read or encoded.
   */
  loadDirectory(): Buffer
  /**
   * The content of `layer_ids` as one MessagePack array of named-field
   * layers, the encoding the engine decodes.
   *
   * # Errors
   *
   * Fails on a malformed or unknown layer id, and when a layer cannot be read or decoded.
   */
  loadLayers(layerIds: Array<string>): Buffer
  /**
   * `glyph_ids` plus every glyph their components use, transitively.
   *
   * # Errors
   *
   * Fails on a malformed glyph id or when the component references cannot be read.
   */
  componentClosure(glyphIds: Array<string>): Array<string>
  /**
   * Glyphs with a component of a glyph that owns one of `layer_ids`.
   *
   * # Errors
   *
   * Fails on a malformed layer id or when the component references cannot be read.
   */
  dependents(layerIds: Array<string>): Array<string>
  /**
   * Closes the store's files now rather than when the reader is collected,
   * so the workspace can delete them. Reads after this fail.
   */
  close(): void
}

/** Reads the settings in a `config.toml` source. */
export declare function configRead(source: string): NapiConfigRead

/**
 * Returns `source` with `theme = "…"` set, preserving everything else;
 * `null` source creates a new file.
 *
 * # Errors
 *
 * Throws when `source` has errors, so an edit never overwrites a file the
 * user is still fixing.
 */
export declare function configSetTheme(source: string | undefined | null, theme: string): string

/**
 * Returns `source` with its `theme` table set, editing an existing table in
 * place; `null` source creates a new file.
 *
 * # Errors
 *
 * Throws when `source` has errors, so an edit never overwrites a file the
 * user is still fixing.
 */
export declare function configSetThemeSlots(source: string | undefined | null, slots: NapiThemeSlots): string

/** One problem in `config.toml`; line and column are one-based. */
export interface NapiConfigProblem {
  severity: NapiConfigSeverity
  message: string
  line?: number
  column?: number
}

/** The settings in a `config.toml` source. */
export interface NapiConfigRead {
  /** Whether the file may be applied; `false` when any problem is an error. */
  valid: boolean
  /** The theme name, when the file is valid and writes `theme = "…"`. */
  theme?: string
  /** The theme table, when the file is valid and writes `theme` as a table. */
  themeSlots?: NapiThemeSlots
  problems: Array<NapiConfigProblem>
}

/**
 * How serious a config problem is: `error` keeps the last valid settings,
 * `warning` applies the file but ignores something in it.
 */
export declare const enum NapiConfigSeverity {
  Error = 'error',
  Warning = 'warning'
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

export interface NapiFeatureSetting {
  /** A feature tag such as `liga`. */
  tag: string
  /** `0` turns the feature off, `1` on; larger values pick an alternate. */
  value: number
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

/** A paragraph to shape, split into runs of one script. */
export interface NapiParagraphRequest {
  units: Array<NapiShapeUnit>
  /** User-space location to shape at; omitted axes are at their default. */
  location: Location
  /** BCP 47 language tag; the default language system when omitted. */
  language?: string
  /** Settings over the features applied by default. */
  features?: Array<NapiFeatureSetting>
}

/**
 * Where a persisted change leaves the font, as the session that made it
 * claims.
 */
export declare const enum NapiSaveState {
  /** The font now differs from the saved document. */
  Unsaved = 'unsaved',
  /**
   * The font is back to the saved document, as an undo or redo onto the
   * saved position leaves it; the store verifies this before trusting it.
   */
  MatchesSaved = 'matchesSaved'
}

/**
 * One shaped glyph. Advances and offsets hold only what the font's feature
 * code positions; glyph advances, kerning, and mark attachment are the
 * caller's to add.
 */
export interface NapiShapedGlyph {
  /** Absent when a character has no glyph. */
  glyphId?: GlyphId
  /** Index of the first unit the glyph came from. */
  cluster: number
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
}

/** One run of a shaped paragraph, in one script and direction. */
export interface NapiShapedRun {
  /** First paragraph unit in the run. */
  start: number
  /** One past the last paragraph unit in the run. */
  end: number
  /**
   * ISO 15924 script tag such as `Arab`; absent when the run holds only
   * characters common to all scripts.
   */
  script?: string
  direction: "ltr" | "rtl"
  /** Glyphs in visual order; clusters index the paragraph's units. */
  glyphs: Array<NapiShapedGlyph>
}

/**
 * How one axis's user coordinates normalize: linear between mapping
 * points, clamped outside them.
 */
export interface NapiShaperAxis {
  axisId: AxisId
  /** User coordinate at each mapping point, increasing. */
  user: Array<number>
  /** Normalized coordinate at each mapping point. */
  normalized: Array<number>
}

/**
 * The compiled shaping tables and what the editor needs to shape with them
 * itself: shaper glyph order and axis normalization.
 */
export interface NapiShaperFont {
  /** Changes exactly when the tables do. */
  revision: number
  /**
   * The shaper font: `GSUB`, `GPOS`, `GDEF`, `head`, and `fvar`, with no
   * outlines, `cmap`, or `hmtx`.
   */
  bytes: Uint8Array
  /**
   * The Shift glyph at each shaper glyph id; null for a `.notdef` the font
   * does not have.
   */
  glyphIds: Array<GlyphId | null>
  /** Each `fvar` axis, in order, with how its user coordinates normalize. */
  axes: Array<NapiShaperAxis>
}

/**
 * One unit of text to shape: exactly one of a character or a glyph inserted
 * by name.
 */
export interface NapiShapeUnit {
  /** A Unicode scalar value. */
  codepoint?: number
  /** A glyph with no character to type, shaped as itself. */
  glyphId?: GlyphId
}

/**
 * Specimen outline drawn on a recent file's thumbnail, in font units with y
 * pointing down.
 */
export interface NapiSpecimen {
  /** Characters shown; empty when glyphs were chosen by glyph order. */
  text: string
  /** SVG path data. */
  outline: string
  /** SVG `viewBox` as `[x, y, width, height]`, fitted to the ink. */
  viewBox: Array<number>
  rightToLeft: boolean
}

/** Whether a theme's background is light or dark. */
export declare const enum NapiThemeAppearance {
  Light = 'light',
  Dark = 'dark'
}

/** A valid theme file's contents. */
export interface NapiThemeFile {
  /** The name shown in Settings, when the file sets one. */
  name?: string
  appearance: NapiThemeAppearance
  /** `base00` through `base0F` as lowercase `#rrggbb`. */
  palette: Array<string>
  /** Overrides of derived colors by name, as `#rrggbb` or `#rrggbbaa`. */
  colors: Record<string, string>
}

/** Which appearance a `theme` table uses. */
export declare const enum NapiThemeMode {
  System = 'system',
  Light = 'light',
  Dark = 'dark'
}

/** The result of reading a theme file. */
export interface NapiThemeRead {
  /** The theme, or nothing when an error means it cannot be used. */
  theme?: NapiThemeFile
  problems: Array<NapiConfigProblem>
}

/**
 * A `theme` table: a mode and the theme used in each appearance; missing
 * keys are left to the app's defaults.
 */
export interface NapiThemeSlots {
  mode?: NapiThemeMode
  light?: string
  dark?: string
}

/** Reads a `themes/<id>.toml` file. */
export declare function themeRead(source: string): NapiThemeRead
export interface AddAnchorsIntent {
  layerId: LayerId
  anchors: Array<AnchorSeed>
}

export interface AddComponentIntent {
  layerId: LayerId
  componentId: ComponentId
  baseGlyphId: GlyphId
}

export interface AddContourIntent {
  layerId: LayerId
  contourId: ContourId
  closed: boolean
}

export interface AddPointsIntent {
  layerId: LayerId
  /** Absent when `before` carries the anchor; Rust derives the contour. */
  contourId?: ContourId
  /** Insert before this point; append when absent. */
  before?: PointId
  points: Array<PointSeed>
}

/**
 * An anchor to create, carrying its caller-minted id (decision 6: ids are
 * client-minted so verbs return identity synchronously).
 */
export interface AnchorSeed {
  id: AnchorId
  name?: string
  x: number
  y: number
}

export interface Axis {
  id: AxisId
  tag: string
  name: string
  role: AxisRole
  axisType: AxisType
  minimum?: number
  default: number
  maximum?: number
  values?: Array<number>
  labels: Array<AxisLabel>
  hidden: boolean
}

export interface AxisLabel {
  id: AxisLabelId
  name: string
  value: number
  minimum?: number
  maximum?: number
  linkedValue?: number
  elidable: boolean
}

export interface AxisMapping {
  id: AxisMappingId
  name: string
  description?: string
  inputs: Array<AxisId>
  outputs: Array<AxisId>
  points: Array<AxisMappingPoint>
}

export interface AxisMappingPoint {
  description?: string
  input: Location
  output: Location
}

export declare const enum AxisRole {
  External = 'external',
  Internal = 'internal'
}

export declare const enum AxisType {
  Continuous = 'continuous',
  Discrete = 'discrete'
}

export interface BooleanOpIntent {
  layerId: LayerId
  contourIdA: ContourId
  contourIdB: ContourId
  /** "union" | "subtract" | "intersect" | "difference" */
  operation: string
}

/** Creates one glyph layer by copying another layer's shape with fresh internal ids. */
export interface CloneGlyphLayerIntent {
  layerId: LayerId
  glyphId: GlyphId
  sourceId: SourceId
  fromLayerId: LayerId
}

/**
 * Font-level axis creation. The axis id is client-minted; the tag is an
 * OpenType label and must be unique within the font.
 */
export interface CreateAxisIntent {
  axis: Axis
}

/**
 * Font-level glyph creation. The glyph id is client-minted (decision 6:
 * verbs return identity synchronously); Rust honors it and rejects
 * duplicates.
 */
export interface CreateGlyphIntent {
  glyphId: GlyphId
  name: GlyphName
  unicodes: Array<Unicode>
}

/** Creates one sparse glyph layer at an existing source for an existing glyph. */
export interface CreateGlyphLayerIntent {
  layerId: LayerId
  glyphId: GlyphId
  sourceId: SourceId
}

/** Creates an empty kerning group under an id the client mints. */
export interface CreateKerningGroupIntent {
  groupId: KerningGroupId
  position: KerningPosition
  name: string
}

/** Creates an authored named instance with client-minted stable identity. */
export interface CreateNamedInstanceIntent {
  instance: NamedInstance
}

/**
 * Font-level source creation. The source id is client-minted so verbs can
 * return identity synchronously; Rust honors it and rejects duplicates.
 */
export interface CreateSourceIntent {
  sourceId: SourceId
  name: string
  /** Axis id → design-space value for the new source. */
  location: Location
}

export interface DecomposeComponentsIntent {
  layerId: LayerId
  componentIds: Array<ComponentId>
}

/** Font-level axis deletion. Removing an axis also reshapes source locations. */
export interface DeleteAxisIntent {
  axisId: AxisId
}

/** Deletes a kerning group; its pairs stay and resolve again on undo. */
export interface DeleteKerningGroupIntent {
  groupId: KerningGroupId
}

/** Deletes an authored named instance without changing sources or geometry. */
export interface DeleteNamedInstanceIntent {
  instanceId: NamedInstanceId
}

/** Font-level source deletion. Removing a source also removes its glyph layers. */
export interface DeleteSourceIntent {
  sourceId: SourceId
}

/** One edit as the editor sends it: `{ kind: "addPoints", addPoints: {…} }`. */
export type FontIntent =
  | { kind: 'addPoints', addPoints: AddPointsIntent }
  | { kind: 'addContour', addContour: AddContourIntent }
  | { kind: 'setContourClosed', setContourClosed: SetContourClosedIntent }
  | { kind: 'movePoints', movePoints: MovePointsIntent }
  | { kind: 'setPointSmooth', setPointSmooth: SetPointSmoothIntent }
  | { kind: 'removePoints', removePoints: RemovePointsIntent }
  | { kind: 'addAnchors', addAnchors: AddAnchorsIntent }
  | { kind: 'moveAnchors', moveAnchors: MoveAnchorsIntent }
  | { kind: 'removeAnchors', removeAnchors: RemoveAnchorsIntent }
  | { kind: 'renameAnchors', renameAnchors: RenameAnchorsIntent }
  | { kind: 'addComponent', addComponent: AddComponentIntent }
  | { kind: 'setComponentTransforms', setComponentTransforms: SetComponentTransformsIntent }
  | { kind: 'setComponentAlignment', setComponentAlignment: SetComponentAlignmentIntent }
  | { kind: 'removeComponents', removeComponents: RemoveComponentsIntent }
  | { kind: 'decomposeComponents', decomposeComponents: DecomposeComponentsIntent }
  | { kind: 'reverseContour', reverseContour: ReverseContourIntent }
  | { kind: 'setContourStart', setContourStart: SetContourStartIntent }
  | { kind: 'translatePoints', translatePoints: TranslatePointsIntent }
  | { kind: 'transformLayer', transformLayer: TransformLayerIntent }
  | { kind: 'setXAdvance', setXAdvance: SetXAdvanceIntent }
  | { kind: 'applyBooleanOp', applyBooleanOp: BooleanOpIntent }
  | { kind: 'createGlyph', createGlyph: CreateGlyphIntent }
  | { kind: 'updateGlyph', updateGlyph: UpdateGlyphIntent }
  | { kind: 'updateFontMetadata', updateFontMetadata: UpdateFontMetadataIntent }
  | { kind: 'setKerningValues', setKerningValues: SetKerningValuesIntent }
  | { kind: 'createKerningGroup', createKerningGroup: CreateKerningGroupIntent }
  | { kind: 'setKerningGroupMember', setKerningGroupMember: SetKerningGroupMemberIntent }
  | { kind: 'renameKerningGroup', renameKerningGroup: RenameKerningGroupIntent }
  | { kind: 'deleteKerningGroup', deleteKerningGroup: DeleteKerningGroupIntent }
  | { kind: 'setLanguages', setLanguages: SetLanguagesIntent }
  | { kind: 'createAxis', createAxis: CreateAxisIntent }
  | { kind: 'updateAxis', updateAxis: UpdateAxisIntent }
  | { kind: 'deleteAxis', deleteAxis: DeleteAxisIntent }
  | { kind: 'setAxisMappings', setAxisMappings: SetAxisMappingsIntent }
  | { kind: 'setMetricDefinitions', setMetricDefinitions: SetMetricDefinitionsIntent }
  | { kind: 'createNamedInstance', createNamedInstance: CreateNamedInstanceIntent }
  | { kind: 'updateNamedInstance', updateNamedInstance: UpdateNamedInstanceIntent }
  | { kind: 'deleteNamedInstance', deleteNamedInstance: DeleteNamedInstanceIntent }
  | { kind: 'deleteSource', deleteSource: DeleteSourceIntent }
  | { kind: 'createSource', createSource: CreateSourceIntent }
  | { kind: 'updateSource', updateSource: UpdateSourceIntent }
  | { kind: 'createGlyphLayer', createGlyphLayer: CreateGlyphLayerIntent }
  | { kind: 'cloneGlyphLayer', cloneGlyphLayer: CloneGlyphLayerIntent }
  | { kind: 'materializeGlyphLayer', materializeGlyphLayer: MaterializeGlyphLayerIntent }

export interface FontMetadata {
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

export declare const enum KerningPosition {
  First = 'first',
  Second = 'second'
}

/** One kerning pair side: `id` is a glyph id when `kind` is `glyph`, else a group id. */
export interface KerningSide {
  kind: KerningSideKind
  id: string
}

export declare const enum KerningSideKind {
  Glyph = 'glyph',
  Group = 'group'
}

/** One kerning pair value to set or remove at one source. */
export interface KerningValueEdit {
  sourceId: SourceId
  first: KerningSide
  second: KerningSide
  /** New value in font units; absent removes the pair at this source. */
  amount?: number
}

export interface Location {
  values: Record<AxisId, number>
}

/** Creates one sparse layer from resolved values at a design-space location. */
export interface MaterializeGlyphLayerIntent {
  layerId: LayerId
  glyphId: GlyphId
  sourceId: SourceId
  fromLayerId: LayerId
  /** Numeric state ordered like `GlyphState.values`. */
  values: Float64Array
}

export interface MetricDefinition {
  id: MetricId
  kind: MetricKind
  name: string
}

export declare const enum MetricKind {
  Ascender = 'ascender',
  CapHeight = 'capHeight',
  XHeight = 'xHeight',
  Baseline = 'baseline',
  Descender = 'descender',
  Custom = 'custom'
}

export interface MoveAnchorsIntent {
  layerId: LayerId
  anchorIds: Array<AnchorId>
  /** Interleaved absolute coordinates: x0, y0, x1, y1, … */
  coords: Array<number>
}

export interface MovePointsIntent {
  layerId: LayerId
  pointIds: Array<PointId>
  /** Interleaved absolute coordinates: x0, y0, x1, y1, … */
  coords: Array<number>
}

/** NAPI projection of one explicit named product preset. */
export interface NamedInstance {
  id: NamedInstanceId
  name: string
  location: Location
  postscriptName?: string
}

export interface NapiAnchorData {
  id: AnchorId
  name?: string
}

export interface NapiAnchorMatch {
  referenceId: AnchorId
  targetId: AnchorId
}

/** Pure-state response to `apply`: no change records cross to the renderer. */
export interface NapiAppliedChange {
  layers: Array<NapiLayerReplaced>
  /** Present when the apply produced any font-level replacement collections. */
  next?: NapiFontReplacement
  /** Stable ids: references survive renames without re-indexing. */
  dependents: Array<GlyphId>
}

export interface NapiAxisMappingBasis {
  mappingId: AxisMappingId
  inputAxisIds: Array<AxisId>
  outputAxisIds: Array<AxisId>
  basis: NapiVariationBasis
}

/** One corner of outline bounds in font units. */
export interface NapiBoundsCorner {
  x: number
  y: number
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

export interface NapiComponentData {
  id: ComponentId
  baseGlyphId: GlyphId
  baseGlyphName: GlyphName
  /**
   * Placed by its anchors (`anchored`) or by hand (`free`); `unset` or absent
   * counts as anchored while the component sits exactly on its anchors.
   */
  alignment?: "anchored" | "free" | "unset"
}

export interface NapiComponentGlyph {
  parentGlyphId: GlyphId
  componentId: ComponentId
  componentIndex: number
  baseGlyphId: GlyphId
  parentPath: Array<ComponentId>
  componentPath: Array<ComponentId>
}

export interface NapiComponentMatch {
  referenceId: ComponentId
  targetId: ComponentId
}

/** Six-value affine placement of a component in its parent layer. */
export interface NapiComponentTransform {
  xx: number
  xy: number
  yx: number
  yy: number
  dx: number
  dy: number
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

export interface NapiContourMatch {
  referenceId: ContourId
  targetId: ContourId
}

export interface NapiDesignNormalization {
  axisId: AxisId
  minimum: number
  default: number
  maximum: number
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
  metadata?: FontMetadata
  /** Full records list when glyph identity changed; absent when untouched. */
  glyphs?: Array<NapiGlyphRecord>
  /** Full axes list when font-level axis structure changed; absent otherwise. */
  axes?: Array<Axis>
  /** Full mapping list when font-level axis mappings changed; absent otherwise. */
  axisMappings?: Array<AxisMapping>
  /** Rust-compiled mapping bases when axes or mappings changed; absent otherwise. */
  axisMappingBases?: Array<NapiAxisMappingBasis>
  /** Full font-owned metric definitions when their identity or order changed. */
  metricDefinitions?: Array<MetricDefinition>
  /** Refreshed source-metric interpolation model when any of its inputs changed. */
  sourceMetricsInterpolation?: NapiSourceMetricsInterpolationReplacement
  /** Full authored product-preset list when named instances changed. */
  namedInstances?: Array<NamedInstance>
  /** Tracked language list when it changed; absent otherwise. */
  languages?: NapiLanguagesReplacement
  /**
   * Full sources list when font-level source structure changed (createAxis
   * reshapes locations, createSource adds one); absent otherwise.
   */
  sources?: Array<NapiSource>
  /** Complete kerning when its values or interpolation basis changed. */
  kerning?: NapiKerningSnapshot
}

export interface NapiFontSnapshot {
  metadata: FontMetadata
  metrics: NapiFontMetrics
  metricDefinitions: Array<MetricDefinition>
  sourceMetricsInterpolation?: NapiSourceMetricsInterpolationSnapshot
  glyphs: Array<NapiGlyphEntry>
  sources: Array<NapiSource>
  axes: Array<Axis>
  axisMappings: Array<AxisMapping>
  axisMappingBases: Array<NapiAxisMappingBasis>
  namedInstances: Array<NamedInstance>
  /** Tracked Hyperglot language ids; absent when the font stores no list. */
  languageIds?: Array<string>
  kerning: NapiKerningSnapshot
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
  decomposition?: NapiInterpolationBasis
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
  /** In the Mark category or classed `mark`: anchor propagation keeps its own anchors. */
  mark?: boolean
  /**
   * A nonspacing mark (Mark category, Nonspacing subcategory): export
   * compiles it with no advance. Absent when it is not one.
   */
  nonspacingMark?: boolean
  /**
   * `"explicit"` when classed a ligature, `"subcategory"` when a ligature
   * once it has an attaching anchor.
   */
  ligature?: "explicit" | "subcategory"
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
  designNormalization: Array<NapiDesignNormalization>
}

export interface NapiInterpolationSupport {
  axisId: AxisId
  lower: number
  peak: number
  upper: number
}

export interface NapiKerningGroup {
  id: KerningGroupId
  position: KerningPosition
  name: string
  glyphIds: Array<GlyphId>
}

export interface NapiKerningPairValue {
  first: KerningSide
  second: KerningSide
  amount: number
}

/**
 * Font kerning: groups, per-source pairs, and the interpolation basis over
 * the default source and every master with pairs (absent for static fonts).
 */
export interface NapiKerningSnapshot {
  groups: Array<NapiKerningGroup>
  sources: Array<NapiSourceKerningPairs>
  basis?: NapiInterpolationBasis
}

/**
 * Replacement wrapper whose presence distinguishes "unchanged" from a
 * change that removed the tracked language list.
 */
export interface NapiLanguagesReplacement {
  /**
   * Tracked Hyperglot language ids in authored order; absent when the font
   * stores no list and callers should apply their own default.
   */
  languageIds?: Array<string>
}

export interface NapiLayerDifference {
  kind: NapiLayerDifferenceKind
  contour?: number
  point?: number
  referenceCount?: number
  targetCount?: number
  referenceClosed?: boolean
  targetClosed?: boolean
  referencePointType?: PointType
  targetPointType?: PointType
  referenceAnchorNames?: Array<string | undefined | null>
  targetAnchorNames?: Array<string | undefined | null>
  referenceComponentIds?: Array<GlyphId> | undefined
  targetComponentIds?: Array<GlyphId> | undefined
}

export declare const enum NapiLayerDifferenceKind {
  ContourCount = 'contourCount',
  ContourClosed = 'contourClosed',
  PointCount = 'pointCount',
  PointType = 'pointType',
  AnchorCount = 'anchorCount',
  AnchorSequence = 'anchorSequence',
  ComponentSequence = 'componentSequence'
}

export interface NapiLayerMatch {
  referenceLayerId: LayerId
  targetLayerId: LayerId
  complete: boolean
  contours: Array<NapiContourMatch>
  points: Array<NapiPointMatch>
  anchors: Array<NapiAnchorMatch>
  components: Array<NapiComponentMatch>
  differences: Array<NapiLayerDifference>
}

/** One accepted-state layer: authored state and its resolved geometry, read together. */
export interface NapiLayerRead {
  authored: NapiGlyphLayerSnapshot
  resolved: NapiResolvedLayerGeometry
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

/** Tight axis-aligned outline bounds in font units, y-up. */
export interface NapiOutlineBounds {
  min: NapiBoundsCorner
  max: NapiBoundsCorner
}

export interface NapiPointData {
  id: PointId
  pointType: PointType
  smooth: boolean
}

export interface NapiPointMatch {
  referenceId: PointId
  targetId: PointId
}

/** One direct component whose outline includes its resolved descendants. */
export interface NapiResolvedComponentGeometry {
  id: ComponentId
  baseGlyphId: GlyphId
  transformation: NapiComponentTransform
  outline: NapiResolvedOutline
}

/** Composited geometry of one exact authored layer at its own source. */
export interface NapiResolvedLayerGeometry {
  outline: NapiResolvedOutline
  components: Array<NapiResolvedComponentGeometry>
}

/** Composited outline as one SVG path in font units with its tight bounds. */
export interface NapiResolvedOutline {
  svgPath: string
  bounds?: NapiOutlineBounds
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
  location: Location
  filename?: string
  metricValues: Array<SourceMetricValue>
  italicAngle?: number
  lineGap?: number
  underlinePosition?: number
  underlineThickness?: number
}

export interface NapiSourceKerningPairs {
  sourceId: SourceId
  pairs: Array<NapiKerningPairValue>
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

export interface NapiSourceMetricValues {
  sourceId: SourceId
  values: Float64Array
}

export interface NapiVariationBasis {
  deltas: Array<NapiVariationDelta>
}

export interface NapiVariationDelta {
  region: Array<NapiInterpolationSupport>
  values: Float64Array
}

/**
 * A point to create, carrying its caller-minted id (decision 6: ids are
 * client-minted so verbs return identity synchronously).
 */
export interface PointSeed {
  id: PointId
  x: number
  y: number
  pointType: PointType
  smooth: boolean
}

export declare const enum PointType {
  OnCurve = 'onCurve',
  OffCurve = 'offCurve',
  QCurve = 'qCurve'
}

export interface RemoveAnchorsIntent {
  layerId: LayerId
  anchorIds: Array<AnchorId>
}

export interface RemoveComponentsIntent {
  layerId: LayerId
  componentIds: Array<ComponentId>
}

export interface RemovePointsIntent {
  layerId: LayerId
  pointIds: Array<PointId>
}

/** Renames anchors in one layer; `names[i]` is the new name of `anchorIds[i]`. */
export interface RenameAnchorsIntent {
  layerId: LayerId
  anchorIds: Array<AnchorId>
  names: Array<string>
}

/** Renames a kerning group; its pairs keep referencing it by id. */
export interface RenameKerningGroupIntent {
  groupId: KerningGroupId
  name: string
}

export interface ReverseContourIntent {
  layerId: LayerId
  contourId: ContourId
}

export interface SetAxisMappingsIntent {
  mappings: Array<AxisMapping>
}

/**
 * Records whether components are placed by their anchors; anchoring one also
 * places it on its anchors now.
 */
export interface SetComponentAlignmentIntent {
  layerId: LayerId
  componentIds: Array<ComponentId>
  alignment: "anchored" | "free" | "unset"
}

export interface SetComponentTransformsIntent {
  layerId: LayerId
  componentIds: Array<ComponentId>
  transforms: Array<number>
}

export interface SetContourClosedIntent {
  layerId: LayerId
  contourId: ContourId
  closed: boolean
}

/** Selects an existing on-curve start for a closed contour; does not move or convert points. */
export interface SetContourStartIntent {
  layerId: LayerId
  contourId: ContourId
  pointId: PointId
}

/** Moves a glyph into a group, or out of its group at `position` without one. */
export interface SetKerningGroupMemberIntent {
  position: KerningPosition
  glyphId: GlyphId
  groupId?: KerningGroupId
}

/** Sets or removes kerning pair values at sources as one undoable edit. */
export interface SetKerningValuesIntent {
  edits: Array<KerningValueEdit>
}

/** Replaces the font's tracked language list as one undoable edit. */
export interface SetLanguagesIntent {
  /**
   * Hyperglot language ids in display order. Blank ids are dropped and
   * duplicates keep their first position; an empty list is stored as-is.
   */
  languageIds: Array<string>
}

export interface SetMetricDefinitionsIntent {
  definitions: Array<MetricDefinition>
}

export interface SetPointSmoothIntent {
  layerId: LayerId
  pointId: PointId
  smooth: boolean
}

export interface SetXAdvanceIntent {
  layerId: LayerId
  width: number
}

export interface SourceMetricValue {
  metricId: MetricId
  position: number
  overshoot: number
}

/** Affine transform of a whole layer: points, anchors, and component placements. */
export interface TransformLayerIntent {
  layerId: LayerId
  /** Six affine values `[a, b, c, d, e, f]`: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. */
  matrix: Array<number>
}

/** Affine move: O(selection-ids) wire instead of O(N) coords. */
export interface TranslatePointsIntent {
  layerId: LayerId
  pointIds: Array<PointId>
  dx: number
  dy: number
}

export interface UpdateAxisIntent {
  axis: Axis
}

/** Replaces the complete authored metadata snapshot without changing metrics. */
export interface UpdateFontMetadataIntent {
  /** Complete replacement snapshot; omitted optional fields are cleared. */
  metadata: FontMetadata
}

/**
 * Font-level glyph update. The glyph id targets an existing committed glyph;
 * names are user-editable labels and are not stable identity.
 */
export interface UpdateGlyphIntent {
  glyphId: GlyphId
  newName: GlyphName
  newUnicodes: Array<Unicode>
}

/** Replaces an authored named instance while retaining its identity. */
export interface UpdateNamedInstanceIntent {
  instance: NamedInstance
}

export interface UpdateSourceIntent {
  sourceId: SourceId
  name: string
  location: Location
  metricValues: Array<SourceMetricValue>
  italicAngle?: number
  lineGap?: number
  underlinePosition?: number
  underlineThickness?: number
}
