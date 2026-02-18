import type {
  FontEngineAPI,
  PointPositionUpdate,
  AnchorPositionUpdate,
} from "@shared/bridge/FontEngineAPI";
import type {
  PointType,
  CommandResult,
  PointId,
  GlyphSnapshot,
  ContourId,
  ContourSnapshot,
  PointSnapshot,
} from "@shift/types";
import { Glyphs } from "@shift/font";

export class MockFontEngine implements FontEngineAPI {
  // Note: also satisfies EditingEngineDeps, SessionEngineDeps, InfoEngineDeps, IOEngineDeps
  // when wrapped by FontEngine (used via managers in tests)
  #snapshot: GlyphSnapshot | null = null;
  #nextId = 1;

  #generateId(): string {
    return String(this.#nextId++);
  }

  #withSession<T>(fn: (snapshot: GlyphSnapshot) => T, errorMsg = "No active edit session"): T {
    if (!this.#snapshot) throw new Error(errorMsg);
    return fn(this.#snapshot);
  }

  #findContour(contourId: string): ContourSnapshot | undefined {
    return Glyphs.findContour(this.#snapshot!, contourId) as ContourSnapshot | undefined;
  }

  #findPoint(
    pointId: string,
  ): { contour: ContourSnapshot; point: PointSnapshot; index: number } | null {
    if (!this.#snapshot) return null;
    const result = Glyphs.findPoint(this.#snapshot!, pointId as PointId);
    if (!result) return null;
    return result as { contour: ContourSnapshot; point: PointSnapshot; index: number };
  }

  #findAnchor(anchorId: string): { id: string; name: string | null; x: number; y: number } | null {
    if (!this.#snapshot) return null;
    return this.#snapshot.anchors.find((a) => a.id === anchorId) ?? null;
  }

  loadFont(_path: string): void {}

  saveFont(_path: string): void {}

  async saveFontAsync(_path: string): Promise<void> {}

  getMetadata(): string {
    return JSON.stringify({
      familyName: "Mock Font",
      styleName: "Regular",
      versionMajor: 1,
      versionMinor: 0,
      copyright: null,
      trademark: null,
      designer: null,
      designerUrl: null,
      manufacturer: null,
      manufacturerUrl: null,
      license: null,
      licenseUrl: null,
      description: null,
      note: null,
    });
  }

  getMetrics(): string {
    return JSON.stringify({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
      italicAngle: 0,
      underlinePosition: -100,
      underlineThickness: 50,
    });
  }

  getGlyphCount(): number {
    return 256;
  }

  getGlyphUnicodes(): number[] {
    return Array.from({ length: 256 }, (_, i) => i);
  }

  getGlyphNameForUnicode(unicode: number): string | null {
    if (!Number.isFinite(unicode) || unicode < 0) return null;
    return String.fromCodePoint(unicode);
  }

  getGlyphUnicodesForName(glyphName: string): number[] {
    if (glyphName.length !== 1) return [];
    return [glyphName.codePointAt(0)!];
  }

  getDependentUnicodes(_unicode: number): number[] {
    return [];
  }

  getDependentUnicodesByName(_glyphName: string): number[] {
    return [];
  }

  getGlyphSvgPath(_unicode: number): string | null {
    return null;
  }

  getGlyphSvgPathByName(_glyphName: string): string | null {
    return null;
  }

  getGlyphAdvance(_unicode: number): number | null {
    return 500;
  }

  getGlyphAdvanceByName(_glyphName: string): number | null {
    return 500;
  }

  getGlyphBbox(_unicode: number): [number, number, number, number] | null {
    return null;
  }

  getGlyphBboxByName(_glyphName: string): [number, number, number, number] | null {
    return null;
  }

  getGlyphCompositeComponents(_glyphName: string): string | null {
    return JSON.stringify({ glyphName: _glyphName, components: [] });
  }

  startEditSession(unicode: number): void {
    this.#snapshot = {
      unicode,
      name: String.fromCodePoint(unicode),
      xAdvance: 500,
      contours: [],
      anchors: [],
      compositeContours: [],
      activeContourId: null as ContourId | null,
    };
  }

  startEditSessionByName(glyphName: string): void {
    const unicode = glyphName.length === 1 ? (glyphName.codePointAt(0) ?? 0) : 0;
    this.#snapshot = {
      unicode,
      name: glyphName,
      xAdvance: 500,
      contours: [],
      anchors: [],
      compositeContours: [],
      activeContourId: null as ContourId | null,
    };
  }

  endEditSession(): void {
    this.#snapshot = null;
  }

  hasEditSession(): boolean {
    return this.#snapshot !== null;
  }

  getEditingUnicode(): number | null {
    return this.#snapshot?.unicode ?? null;
  }

  getEditingGlyphName(): string | null {
    return this.#snapshot?.name ?? null;
  }

  getSnapshotData(): string {
    if (!this.#snapshot) {
      throw new Error("No active edit session");
    }
    return JSON.stringify(this.#snapshot);
  }

  restoreSnapshot(snapshotJson: string): boolean {
    const snapshot = JSON.parse(snapshotJson) as GlyphSnapshot;
    if (!Array.isArray(snapshot.compositeContours)) {
      snapshot.compositeContours = [];
    }
    this.#snapshot = snapshot;
    return true;
  }

  #addEmptyContour(): ContourId {
    return this.#withSession((snap) => {
      const contourId = this.#generateId() as ContourId;
      snap.contours.push({ id: contourId, points: [], closed: false });
      snap.activeContourId = contourId;
      return contourId;
    });
  }

  addContour(): string {
    this.#addEmptyContour();
    return this.#makeResult(true, []);
  }

  getActiveContourId(): ContourId | null {
    return this.#snapshot?.activeContourId as ContourId | null;
  }

  closeContour(): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const activeContour = this.#findContour(this.#snapshot.activeContourId ?? "");
    if (activeContour) activeContour.closed = true;

    return this.#makeResult(true, []);
  }

  setXAdvance(width: number): string {
    return this.#withSession((snap) => {
      snap.xAdvance = width;
      return this.#makeResult(true, []);
    });
  }

  translateLayer(dx: number, dy: number): string {
    return this.#withSession((snap) => {
      for (const contour of snap.contours) {
        for (const point of contour.points) {
          point.x += dx;
          point.y += dy;
        }
      }

      for (const anchor of snap.anchors) {
        anchor.x += dx;
        anchor.y += dy;
      }

      for (const contour of snap.compositeContours) {
        for (const point of contour.points) {
          point.x += dx;
          point.y += dy;
        }
      }

      return this.#makeResult(true, []);
    });
  }

  setActiveContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#findContour(contourId);
    if (!contour) return this.#makeResult(false, [], `Contour ${contourId} not found`);

    this.#snapshot.activeContourId = contourId as ContourId;
    return this.#makeResult(true, []);
  }

  clearActiveContour(): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");
    this.#snapshot.activeContourId = null;
    return this.#makeResult(true, []);
  }

  reverseContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#findContour(contourId);
    if (!contour) return this.#makeResult(false, [], `Contour ${contourId} not found`);

    contour.points.reverse();
    return this.#makeResult(true, []);
  }

  removeContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const index = this.#snapshot.contours.findIndex((c) => c.id === contourId);
    if (index === -1) return this.#makeResult(false, [], `Contour ${contourId} not found`);

    this.#snapshot.contours.splice(index, 1);
    if (this.#snapshot.activeContourId === contourId) {
      this.#snapshot.activeContourId =
        this.#snapshot.contours.length > 0 ? this.#snapshot.contours[0].id : null;
    }

    return this.#makeResult(true, []);
  }

  openContour(contourId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#findContour(contourId);
    if (!contour) return this.#makeResult(false, [], `Contour ${contourId} not found`);

    contour.closed = false;
    return this.#makeResult(true, []);
  }

  addPoint(x: number, y: number, pointType: PointType, smooth: boolean): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    if (!this.#snapshot.activeContourId) this.#addEmptyContour();

    const activeContour = this.#findContour(this.#snapshot.activeContourId ?? "");
    if (!activeContour) return this.#makeResult(false, [], "No active contour");

    const pointId = this.#generateId() as PointId;
    activeContour.points.push({ id: pointId, x, y, pointType, smooth });
    return this.#makeResult(true, [pointId]);
  }

  addPointToContour(
    contourId: string,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#findContour(contourId);
    if (!contour) return this.#makeResult(false, [], `Contour ${contourId} not found`);

    const pointId = this.#generateId() as PointId;
    contour.points.push({ id: pointId, x, y, pointType, smooth });
    return this.#makeResult(true, [pointId]);
  }

  movePoints(pointIds: string[], dx: number, dy: number): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const moved: PointId[] = [];
    for (const contour of this.#snapshot.contours) {
      for (const point of contour.points) {
        if (pointIds.includes(point.id)) {
          point.x += dx;
          point.y += dy;
          moved.push(point.id);
        }
      }
    }
    return this.#makeResult(true, moved);
  }

  moveAnchors(anchorIds: string[], dx: number, dy: number): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    for (const anchor of this.#snapshot.anchors) {
      if (anchorIds.includes(anchor.id)) {
        anchor.x += dx;
        anchor.y += dy;
      }
    }
    return this.#makeResult(true, []);
  }

  removePoints(pointIds: string[]): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    for (const contour of this.#snapshot.contours) {
      contour.points = contour.points.filter((p) => !pointIds.includes(p.id));
    }
    return this.#makeResult(true, pointIds as PointId[]);
  }

  insertPointBefore(
    beforePointId: string,
    x: number,
    y: number,
    pointType: PointType,
    smooth: boolean,
  ): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const found = this.#findPoint(beforePointId);
    if (!found) return this.#makeResult(false, [], `Point ${beforePointId} not found`);

    const newPointId = this.#generateId() as PointId;
    found.contour.points.splice(found.index, 0, { id: newPointId, x, y, pointType, smooth });
    return this.#makeResult(true, [newPointId]);
  }

  toggleSmooth(pointId: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const found = this.#findPoint(pointId);
    if (!found) return this.#makeResult(false, [], `Point ${pointId} not found`);

    found.point.smooth = !found.point.smooth;
    return this.#makeResult(true, [pointId as PointId]);
  }

  setPointPositions(updates: PointPositionUpdate[]): boolean {
    if (!this.#snapshot) return false;

    for (const update of updates) {
      const found = this.#findPoint(update.id);
      if (found) {
        found.point.x = update.x;
        found.point.y = update.y;
      }
    }

    return true;
  }

  setAnchorPositions(updates: AnchorPositionUpdate[]): boolean {
    if (!this.#snapshot) return false;

    for (const update of updates) {
      const found = this.#findAnchor(update.id);
      if (found) {
        found.x = update.x;
        found.y = update.y;
      }
    }

    return true;
  }

  pasteContours(contoursJson: string, offsetX: number, offsetY: number): string {
    if (!this.#snapshot) {
      return JSON.stringify({
        success: false,
        createdPointIds: [],
        createdContourIds: [],
        error: "No active edit session",
      });
    }

    try {
      const contours = JSON.parse(contoursJson);
      const createdPointIds: string[] = [];
      const createdContourIds: string[] = [];

      for (const pasteContour of contours) {
        const contourId = this.#generateId() as ContourId;
        const newContour: ContourSnapshot = {
          id: contourId,
          closed: pasteContour.closed ?? false,
          points: pasteContour.points.map((p: any) => {
            const pointId = this.#generateId() as PointId;
            createdPointIds.push(pointId);
            return {
              id: pointId,
              x: p.x + offsetX,
              y: p.y + offsetY,
              pointType: p.pointType,
              smooth: p.smooth ?? false,
            };
          }),
        };

        this.#snapshot.contours.push(newContour);
        createdContourIds.push(contourId);
      }

      return JSON.stringify({
        success: true,
        createdPointIds,
        createdContourIds,
        error: null,
      });
    } catch (e) {
      return JSON.stringify({
        success: false,
        createdPointIds: [],
        createdContourIds: [],
        error: `Failed to parse contours: ${e}`,
      });
    }
  }

  #makeResult(success: boolean, affectedPointIds: PointId[], error?: string): string {
    const result: CommandResult = {
      success,
      snapshot: this.#snapshot!,
      error: error ?? null,
      affectedPointIds: affectedPointIds.length > 0 ? affectedPointIds : null,
      canUndo: false,
      canRedo: false,
    };
    return JSON.stringify(result);
  }
}

export function createMockNative(): FontEngineAPI {
  return new MockFontEngine();
}
