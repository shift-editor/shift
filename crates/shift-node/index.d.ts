import type { ContourId, PointId, AnchorId } from "@shift/types";
export declare class FontEngine {
  constructor()
  loadFont(path: string): void
  saveFont(path: string): void
  saveFontAsync(path: string): Promise<void>
  getMetadata(): string
  getMetrics(): string
  getGlyphCount(): number
  getGlyphUnicodes(): Array<number>
  getGlyphNameForUnicode(unicode: number): string | null
  getGlyphUnicodesForName(glyphName: string): Array<number>
  /**
   * Returns all Unicode codepoints whose glyphs depend on `unicode` via
   * component relationships (transitively).
   */
  getDependentUnicodes(unicode: number): Array<number>
  getDependentUnicodesByName(glyphName: string): Array<number>
  /**
   * Returns SVG path data for the glyph, including resolved component
   * contours from composite dependencies.
   */
  getGlyphSvgPath(unicode: number): string | null
  getGlyphSvgPathByName(glyphName: string): string | null
  getGlyphAdvance(unicode: number): number | null
  getGlyphAdvanceByName(glyphName: string): number | null
  /**
   * Returns a tight bounding box `[min_x, min_y, max_x, max_y]` for the glyph,
   * including resolved component contours.
   */
  getGlyphBbox(unicode: number): Array<number> | null
  getGlyphBboxByName(glyphName: string): Array<number> | null
  getGlyphCompositeComponents(glyphName: string): string | null
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
  moveNodes(nodes: Array<JsNodeRef>, dx: number, dy: number): string
  removePoints(pointIds: Array<string>): string
  toggleSmooth(pointId: string): string
  pasteContours(contoursJson: string, offsetX: number, offsetY: number): string
  removeContour(contourId: string): string
  /**
   * Set node positions directly — fire-and-forget for drag operations.
   * Returns true on success, false if no edit session is active.
   * Does NOT return a snapshot — use get_snapshot_data() when needed.
   */
  setNodePositions(moves: Array<JsNodePositionUpdate>): boolean
  setPointPositions(moves: Array<JsPointMove>): boolean
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

/** Input type for set_point_positions - a single point move. */
export interface JsPointMove {
  id: string
  x: number
  y: number
}
