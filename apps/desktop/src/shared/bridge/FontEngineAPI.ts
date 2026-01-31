export type {
  JsGlyphSnapshot,
  JsContourSnapshot,
  JsPointSnapshot,
  JsFontMetrics,
  JsFontMetaData,
} from "shift-node";

/**
 * Lightweight point move for drag operations
 */
export interface PointMove {
  id: string;
  x: number;
  y: number;
}

/**
 * Result of lightweight move operation
 */
export interface MoveResult {
  success: boolean;
  affectedIds: string[];
}

export interface FontEngineAPI {
  loadFont(path: string): void;
  saveFont(path: string): void;
  getMetadata(): import("shift-node").JsFontMetaData;
  getMetrics(): import("shift-node").JsFontMetrics;
  getGlyphCount(): number;
  startEditSession(unicode: number): void;
  endEditSession(): void;
  hasEditSession(): boolean;
  getEditingUnicode(): number | null;
  getSnapshot(): string | null;
  getSnapshotData(): import("shift-node").JsGlyphSnapshot;
  addEmptyContour(): string;
  addContour(): string;
  getActiveContourId(): string | null;
  closeContour(): string;
  setActiveContour(contourId: string): string;
  clearActiveContour(): string;
  reverseContour(contourId: string): string;
  removeContour(contourId: string): string;
  openContour(contourId: string): string;
  addPoint(x: number, y: number, pointType: "onCurve" | "offCurve", smooth: boolean): string;
  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;
  movePoints(pointIds: string[], dx: number, dy: number): string;
  removePoints(pointIds: string[]): string;
  insertPointBefore(
    beforePointId: string,
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;
  toggleSmooth(pointId: string): string;
  applyEditsUnified(pointIds: string[], dx: number, dy: number): string;
  pasteContours(contoursJson: string, offsetX: number, offsetY: number): string;
  restoreSnapshot(snapshotJson: string): string;

  // ═══════════════════════════════════════════════════════════
  // LIGHTWEIGHT DRAG OPERATIONS (no snapshot return)
  // ═══════════════════════════════════════════════════════════

  /**
   * Set point positions directly - fire-and-forget for drag operations.
   * Does NOT return a snapshot - use getSnapshotData() when needed.
   */
  setPointPositions(moves: PointMove[]): boolean;

  /**
   * Move points by delta - lightweight version that returns only affected IDs.
   * Does NOT return a snapshot - use getSnapshotData() when needed.
   */
  movePointsFast(pointIds: string[], dx: number, dy: number): MoveResult;

  /**
   * Restore snapshot from native object - no JSON parsing needed.
   */
  restoreSnapshotNative(snapshot: import("shift-node").JsGlyphSnapshot): boolean;
}

declare global {
  interface Window {
    shiftFont?: FontEngineAPI;
  }
}
