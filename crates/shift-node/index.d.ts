import type { ContourId, PointId, AnchorId } from "@shift/types";
export declare class FontEngine {
  constructor()
  loadFont(path: string): void
  saveFont(path: string): void
  getGlyphCount(): number
  saveFontAsync(path: string): Promise<void>
  getMetadata(): string
  getMetrics(): string
  getGlyphUnicodes(): Array<number>
  getGlyphNameForUnicode(unicode: number): string | null
  getDependentUnicodesByName(glyphName: string): Array<number>
  /**
   * Returns SVG path data for the glyph, including resolved component
   * contours from composite dependencies.
   */
  getGlyphSvgPath(unicode: number): string | null
  getGlyphSvgPathByName(glyphName: string): string | null
  getGlyphAdvanceByName(glyphName: string): number | null
  getGlyphBboxByName(glyphName: string): Array<number> | null
  getGlyphCompositeComponents(glyphName: string): string | null
  isVariable(): boolean
  getAxes(): string
  getSources(): string
  /** Returns a JSON array of master snapshots for a glyph. */
  getGlyphMasterSnapshots(glyphName: string): string | null
  /**
   * Bundled per-glyph fetch for the render-side `GlyphView` model.
   *
   * One FFI returns geometry (default master), variation deltas (or `None`
   * for non-variable fonts), and component refs (names + transforms — not
   * pre-flattened). The renderer constructs a reactive `GlyphView` from
   * this and recurses into composites at iteration time.
   */
  getGlyphData(glyphName: string): string | null
  getGlyphVariationData(glyphName: string): string | null
  startEditSession(glyphRef: JsGlyphRef): void
  endEditSession(): void
  hasEditSession(): boolean
  getEditingUnicode(): number | null
  getEditingGlyphName(): string | null
  getActiveContourId(): ContourId | null
  setXAdvance(width: number): string
  translateLayer(dx: number, dy: number): string
  setActiveContour(contourId: string): string
  clearActiveContour(): string
  getSnapshotData(): string
  addPoint(x: number, y: number, pointType: string, smooth: boolean): string
  addPointToContour(contourId: string, x: number, y: number, pointType: string, smooth: boolean): string
  insertPointBefore(beforePointId: string, x: number, y: number, pointType: string, smooth: boolean): string
  addContour(): string
  closeContour(): string
  openContour(contourId: string): string
  reverseContour(contourId: string): string
  applyBooleanOp(contourIdA: string, contourIdB: string, operation: string): string
  moveNodes(nodes: Array<JsNodeRef>, dx: number, dy: number): string
  removePoints(pointIds: Array<string>): string
  toggleSmooth(pointId: string): string
  pasteContours(contoursJson: string, offsetX: number, offsetY: number): string
  setNodePositions(moves: Array<JsNodePositionUpdate>): boolean
  /**
   * Bulk position update via Float64Array.
   * IDs are PointId/AnchorId u64 values packed as f64.
   * Coords are interleaved [x0, y0, x1, y1, ...].
   * Bulk position update via zero-copy Float64Array.
   * IDs are PointId/AnchorId u64 values packed as f64.
   * Coords are interleaved [x0, y0, x1, y1, ...].
   * Pass null for empty arrays (napi-rs panics on zero-length Float64Array).
   */
  setPositions(pointIds?: Float64Array | undefined | null, pointCoords?: Float64Array | undefined | null, anchorIds?: Float64Array | undefined | null, anchorCoords?: Float64Array | undefined | null): boolean
  restoreSnapshot(snapshotJson: string): boolean
}

export interface JsGlyphRef {
  glyphName: string
  unicode?: number
}

/** Input type for set_node_positions - a single node move. */
export interface JsNodePositionUpdate {
  node: JsNodeRef
  x: number
  y: number
}

/** Tagged node reference for node-based drag/edit operations. */
export interface JsNodeRef {
  kind: 'point' | 'anchor' | 'guideline'
  id: string
}
