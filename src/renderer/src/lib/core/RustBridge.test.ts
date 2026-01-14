import { describe, it, expect, beforeEach } from 'vitest';

import { MockRustBridge } from './RustBridge';
import type { AddPointCommand, MovePointsCommand } from '../../types/commands';
import {
  isPointCommand,
  isContourCommand,
  isHistoryCommand,
} from '../../types/commands';
import {
  findPointInSnapshot,
  findContourInSnapshot,
  getAllPointIds,
  createEmptyGlyphSnapshot,
} from '../../types/snapshots';

describe('MockRustBridge', () => {
  let bridge: MockRustBridge;

  beforeEach(() => {
    bridge = new MockRustBridge();
  });

  describe('Session Management', () => {
    it('should start an edit session', () => {
      bridge.startEditSession(65); // 'A'

      const snapshot = bridge.getSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot?.unicode).toBe(65);
      expect(snapshot?.contours).toHaveLength(0);
    });

    it('should end an edit session', () => {
      bridge.startEditSession(65);
      bridge.endEditSession();

      const snapshot = bridge.getSnapshot();
      expect(snapshot).toBeNull();
    });

    it('should return null snapshot when no session', () => {
      const snapshot = bridge.getSnapshot();
      expect(snapshot).toBeNull();
    });
  });

  describe('Contour Operations', () => {
    beforeEach(() => {
      bridge.startEditSession(65);
    });

    it('should add a contour', () => {
      const result = bridge.sendCommand({ type: 'addContour' });

      expect(result.success).toBe(true);
      expect(result.snapshot?.contours).toHaveLength(1);
      expect(result.snapshot?.activeContourId).toBe(result.snapshot?.contours[0].id);
    });

    it('should track active contour', () => {
      bridge.sendCommand({ type: 'addContour' });
      const result1 = bridge.getSnapshot();
      const firstContourId = result1?.contours[0].id;

      bridge.sendCommand({ type: 'addContour' });
      const result2 = bridge.getSnapshot();

      expect(result2?.contours).toHaveLength(2);
      expect(result2?.activeContourId).not.toBe(firstContourId);
    });

    it('should close a contour', () => {
      bridge.sendCommand({ type: 'addContour' });
      const contourId = bridge.getSnapshot()?.activeContourId!;

      const result = bridge.sendCommand({
        type: 'closeContour',
        contourId,
      });

      expect(result.success).toBe(true);
      expect(result.snapshot?.contours[0].closed).toBe(true);
    });
  });

  describe('Point Operations', () => {
    beforeEach(() => {
      bridge.startEditSession(65);
      bridge.sendCommand({ type: 'addContour' });
    });

    it('should add a point to active contour', () => {
      const cmd: AddPointCommand = {
        type: 'addPoint',
        x: 100,
        y: 200,
        pointType: 'onCurve',
        smooth: false,
      };

      const result = bridge.sendCommand(cmd);

      expect(result.success).toBe(true);
      expect(result.snapshot?.contours[0].points).toHaveLength(1);

      const point = result.snapshot?.contours[0].points[0];
      expect(point?.x).toBe(100);
      expect(point?.y).toBe(200);
      expect(point?.pointType).toBe('onCurve');
      expect(point?.smooth).toBe(false);
    });

    it('should add multiple points', () => {
      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });
      bridge.sendCommand({ type: 'addPoint', x: 100, y: 0, pointType: 'onCurve' });
      bridge.sendCommand({ type: 'addPoint', x: 100, y: 100, pointType: 'onCurve' });

      const snapshot = bridge.getSnapshot();
      expect(snapshot?.contours[0].points).toHaveLength(3);
    });

    it('should add off-curve points', () => {
      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });
      bridge.sendCommand({ type: 'addPoint', x: 50, y: 50, pointType: 'offCurve' });
      bridge.sendCommand({ type: 'addPoint', x: 100, y: 0, pointType: 'onCurve' });

      const snapshot = bridge.getSnapshot();
      const points = snapshot?.contours[0].points;

      expect(points?.[0].pointType).toBe('onCurve');
      expect(points?.[1].pointType).toBe('offCurve');
      expect(points?.[2].pointType).toBe('onCurve');
    });

    it('should move points', () => {
      bridge.sendCommand({ type: 'addPoint', x: 100, y: 100, pointType: 'onCurve' });
      const pointId = bridge.getSnapshot()?.contours[0].points[0].id!;

      const cmd: MovePointsCommand = {
        type: 'movePoints',
        pointIds: [pointId],
        dx: 50,
        dy: -25,
        preview: false,
      };

      const result = bridge.sendCommand(cmd);

      expect(result.success).toBe(true);
      const point = result.snapshot?.contours[0].points[0];
      expect(point?.x).toBe(150);
      expect(point?.y).toBe(75);
    });

    it('should move multiple points', () => {
      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });
      bridge.sendCommand({ type: 'addPoint', x: 100, y: 0, pointType: 'onCurve' });

      const snapshot = bridge.getSnapshot();
      const pointIds = snapshot?.contours[0].points.map((p) => p.id)!;

      bridge.sendCommand({
        type: 'movePoints',
        pointIds,
        dx: 10,
        dy: 20,
        preview: false,
      });

      const result = bridge.getSnapshot();
      expect(result?.contours[0].points[0].x).toBe(10);
      expect(result?.contours[0].points[0].y).toBe(20);
      expect(result?.contours[0].points[1].x).toBe(110);
      expect(result?.contours[0].points[1].y).toBe(20);
    });

    it('should remove points', () => {
      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });
      bridge.sendCommand({ type: 'addPoint', x: 100, y: 0, pointType: 'onCurve' });

      const pointId = bridge.getSnapshot()?.contours[0].points[0].id!;

      const result = bridge.sendCommand({
        type: 'removePoints',
        pointIds: [pointId],
      });

      expect(result.success).toBe(true);
      expect(result.snapshot?.contours[0].points).toHaveLength(1);
    });

    it('should return affected point IDs', () => {
      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });

      const result = bridge.sendCommand({
        type: 'addPoint',
        x: 100,
        y: 100,
        pointType: 'onCurve',
      });

      expect(result.affectedPointIds).toBeDefined();
      expect(result.affectedPointIds).toHaveLength(1);
    });
  });

  describe('Undo/Redo', () => {
    beforeEach(() => {
      bridge.startEditSession(65);
      bridge.sendCommand({ type: 'addContour' });
    });

    it('should track canUndo state', () => {
      expect(bridge.canUndo()).toBe(false);

      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });
      const pointId = bridge.getSnapshot()?.contours[0].points[0].id!;

      // Preview doesn't affect undo
      bridge.sendCommand({
        type: 'movePoints',
        pointIds: [pointId],
        dx: 10,
        dy: 10,
        preview: true,
      });
      expect(bridge.canUndo()).toBe(false);

      // Commit does
      bridge.sendCommand({
        type: 'movePoints',
        pointIds: [pointId],
        dx: 10,
        dy: 10,
        preview: false,
      });
      expect(bridge.canUndo()).toBe(true);
    });

    it('should track canRedo state', () => {
      expect(bridge.canRedo()).toBe(false);

      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });
      const pointId = bridge.getSnapshot()?.contours[0].points[0].id!;

      bridge.sendCommand({
        type: 'movePoints',
        pointIds: [pointId],
        dx: 10,
        dy: 10,
        preview: false,
      });

      bridge.sendCommand({ type: 'undo' });

      expect(bridge.canRedo()).toBe(true);
      expect(bridge.canUndo()).toBe(false);
    });

    it('should return canUndo/canRedo in CommandResult', () => {
      bridge.sendCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' });
      const pointId = bridge.getSnapshot()?.contours[0].points[0].id!;

      const result = bridge.sendCommand({
        type: 'movePoints',
        pointIds: [pointId],
        dx: 10,
        dy: 10,
        preview: false,
      });

      expect(result.canUndo).toBe(true);
      expect(result.canRedo).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should error when adding point without session', () => {
      const result = bridge.sendCommand({
        type: 'addPoint',
        x: 0,
        y: 0,
        pointType: 'onCurve',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active edit session');
    });

    it('should error when adding point without contour', () => {
      bridge.startEditSession(65);

      const result = bridge.sendCommand({
        type: 'addPoint',
        x: 0,
        y: 0,
        pointType: 'onCurve',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active contour');
    });

    it('should error when closing non-existent contour', () => {
      bridge.startEditSession(65);

      const result = bridge.sendCommand({
        type: 'closeContour',
        contourId: 'non-existent-id',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Font Info', () => {
    it('should return metadata', () => {
      const metadata = bridge.getMetadata();

      expect(metadata.family).toBeDefined();
      expect(metadata.styleName).toBeDefined();
      expect(metadata.version).toBeDefined();
    });

    it('should return metrics', () => {
      const metrics = bridge.getMetrics();

      expect(metrics.unitsPerEm).toBeGreaterThan(0);
      expect(metrics.ascender).toBeDefined();
      expect(metrics.descender).toBeDefined();
      expect(metrics.capHeight).toBeDefined();
      expect(metrics.xHeight).toBeDefined();
    });

    it('should return glyph count', () => {
      const count = bridge.getGlyphCount();
      expect(count).toBeGreaterThan(0);
    });
  });
});

describe('Command Type Guards', () => {
  it('isPointCommand should identify point commands', () => {
    expect(isPointCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' })).toBe(true);
    expect(isPointCommand({ type: 'movePoints', pointIds: [], dx: 0, dy: 0, preview: false })).toBe(true);
    expect(isPointCommand({ type: 'addContour' })).toBe(false);
    expect(isPointCommand({ type: 'undo' })).toBe(false);
  });

  it('isContourCommand should identify contour commands', () => {
    expect(isContourCommand({ type: 'addContour' })).toBe(true);
    expect(isContourCommand({ type: 'closeContour', contourId: 'x' })).toBe(true);
    expect(isContourCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' })).toBe(false);
  });

  it('isHistoryCommand should identify history commands', () => {
    expect(isHistoryCommand({ type: 'undo' })).toBe(true);
    expect(isHistoryCommand({ type: 'redo' })).toBe(true);
    expect(isHistoryCommand({ type: 'addPoint', x: 0, y: 0, pointType: 'onCurve' })).toBe(false);
  });
});

describe('Snapshot Helpers', () => {
  it('findPointInSnapshot should find points', () => {
    const snapshot = createEmptyGlyphSnapshot(65);
    snapshot.contours.push({
      id: 'c1',
      closed: false,
      points: [
        { id: 'p1', x: 0, y: 0, pointType: 'onCurve', smooth: false },
        { id: 'p2', x: 100, y: 0, pointType: 'onCurve', smooth: false },
      ],
    });

    const point = findPointInSnapshot(snapshot, 'p2');
    expect(point).toBeDefined();
    expect(point?.x).toBe(100);

    const notFound = findPointInSnapshot(snapshot, 'p99');
    expect(notFound).toBeUndefined();
  });

  it('getAllPointIds should collect all IDs', () => {
    const snapshot = createEmptyGlyphSnapshot(65);
    snapshot.contours.push({
      id: 'c1',
      closed: false,
      points: [
        { id: 'p1', x: 0, y: 0, pointType: 'onCurve', smooth: false },
      ],
    });
    snapshot.contours.push({
      id: 'c2',
      closed: false,
      points: [
        { id: 'p2', x: 0, y: 0, pointType: 'onCurve', smooth: false },
        { id: 'p3', x: 0, y: 0, pointType: 'onCurve', smooth: false },
      ],
    });

    const ids = getAllPointIds(snapshot);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
    expect(ids).toContain('p3');
  });
});
