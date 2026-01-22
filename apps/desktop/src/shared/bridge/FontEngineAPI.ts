export type {
  JsGlyphSnapshot,
  JsContourSnapshot,
  JsPointSnapshot,
  JsFontMetrics,
  JsFontMetaData,
} from "shift-node";

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
  reverseContour(contourId: string): string;
  removeContour(contourId: string): string;
  addPoint(
    x: number,
    y: number,
    pointType: "onCurve" | "offCurve",
    smooth: boolean,
  ): string;
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
}

declare global {
  interface Window {
    shiftFont?: FontEngineAPI;
  }
}
