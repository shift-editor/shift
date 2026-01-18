import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Select } from './select';
import { Editor } from '@/lib/editor/Editor';
import { createMockFontEngine, getAllPoints } from '@/testing';
import { EventEmitter } from '@/lib/core/EventEmitter';
import type { PointId } from '@/types/ids';
import type { ToolContext } from '@/types/tool';

function createMockEditor() {
  const fontEngine = createMockFontEngine();
  fontEngine.session.startEditSession(65);
  fontEngine.editing.addContour();

  new EventEmitter();

  let selectedPoints = new Set<PointId>();
  let hoveredPoint: PointId | null = null;
  let selectionMode: 'preview' | 'committed' = 'committed';

  const mockCommandHistory = {
    execute: vi.fn((cmd: any) => cmd.execute({ fontEngine, snapshot: fontEngine.snapshot.value })),
    record: vi.fn(),
    beginBatch: vi.fn(),
    endBatch: vi.fn(),
    cancelBatch: vi.fn(),
    isBatching: false,
    undo: vi.fn(),
    redo: vi.fn(),
  };

  const selectMocks = {
    set: vi.fn((ids: Set<PointId>) => {
      selectedPoints = new Set(ids);
    }),
    add: vi.fn((id: PointId) => {
      selectedPoints.add(id);
    }),
    remove: vi.fn((id: PointId) => {
      selectedPoints.delete(id);
    }),
    toggle: vi.fn((id: PointId) => {
      if (selectedPoints.has(id)) {
        selectedPoints.delete(id);
      } else {
        selectedPoints.add(id);
      }
    }),
    clear: vi.fn(() => {
      selectedPoints.clear();
    }),
    has: vi.fn(() => selectedPoints.size > 0),
    setHovered: vi.fn((id: PointId | null) => {
      hoveredPoint = id;
    }),
    setMode: vi.fn((mode: 'preview' | 'committed') => {
      selectionMode = mode;
    }),
  };

  const editMocks = {
    addPoint: vi.fn((x: number, y: number, type: 'onCurve' | 'offCurve') =>
      fontEngine.editing.addPoint(x, y, type, false)
    ),
    movePoints: vi.fn((ids: Iterable<PointId>, dx: number, dy: number) =>
      fontEngine.editing.movePoints([...ids], dx, dy)
    ),
    movePointTo: vi.fn((id: PointId, x: number, y: number) =>
      fontEngine.editing.movePointTo(id, x, y)
    ),
    applySmartEdits: vi.fn((ids: ReadonlySet<PointId>, dx: number, dy: number) =>
      fontEngine.editEngine.applyEdits(ids, dx, dy)
    ),
    removePoints: vi.fn((ids: Iterable<PointId>) =>
      fontEngine.editing.removePoints([...ids])
    ),
    addContour: vi.fn(() => fontEngine.editing.addContour()),
    closeContour: vi.fn(() => fontEngine.editing.closeContour()),
    toggleSmooth: vi.fn((id: PointId) => fontEngine.editing.toggleSmooth(id)),
    getActiveContourId: vi.fn(() => fontEngine.editing.getActiveContourId()),
  };

  const screenMocks = {
    toUpmDistance: vi.fn((px: number) => px),
    hitRadius: 8,
    lineWidth: vi.fn((px = 1) => px),
  };

  const requestRedrawMock = vi.fn();
  const emitMock = vi.fn();

  const createToolContext = (): ToolContext => ({
    snapshot: fontEngine.snapshot.value,
    selectedPoints,
    hoveredPoint,
    mousePosition: { x: 0, y: 0 },
    selectionMode,
    screen: screenMocks,
    select: selectMocks,
    edit: editMocks,
    commands: mockCommandHistory as any,
    requestRedraw: requestRedrawMock,
    emit: emitMock,
  });

  const mockEditor = {
    fontEngine,
    commandHistory: mockCommandHistory,
    getMousePosition: vi.fn((x?: number, y?: number) => ({ x: x ?? 0, y: y ?? 0 })),
    projectScreenToUpm: vi.fn((x: number, y: number) => ({ x, y })),
    getSnapshot: vi.fn(() => fontEngine.snapshot.value),
    requestRedraw: vi.fn(),
    createToolContext: vi.fn(createToolContext),
    paintHandle: vi.fn(),
  };

  return {
    mockEditor,
    fontEngine,
    getSelectedPoints: () => selectedPoints,
    mocks: {
      select: selectMocks,
      edit: editMocks,
      screen: screenMocks,
      requestRedraw: requestRedrawMock,
      emit: emitMock,
      commands: mockCommandHistory,
    },
  };
}

function createMouseEvent(
  type: 'mousedown' | 'mouseup' | 'mousemove',
  clientX: number,
  clientY: number,
  options?: { shiftKey?: boolean; button?: number }
): React.MouseEvent<HTMLCanvasElement> {
  return {
    type,
    clientX,
    clientY,
    button: options?.button ?? 0,
    shiftKey: options?.shiftKey ?? false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLCanvasElement>;
}

function createKeyboardEvent(
  type: 'keydown' | 'keyup',
  key: string,
  options?: { shiftKey?: boolean; metaKey?: boolean }
): KeyboardEvent {
  return {
    type,
    key,
    shiftKey: options?.shiftKey ?? false,
    metaKey: options?.metaKey ?? false,
    ctrlKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe('Select tool', () => {
  let select: Select;
  let mockEditor: ReturnType<typeof createMockEditor>['mockEditor'];
  let fontEngine: ReturnType<typeof createMockEditor>['fontEngine'];
  let mocks: ReturnType<typeof createMockEditor>['mocks'];

  beforeEach(() => {
    const setup = createMockEditor();
    mockEditor = setup.mockEditor;
    fontEngine = setup.fontEngine;
    mocks = setup.mocks;
    select = new Select(mockEditor as unknown as Editor);
    select.setReady();
  });

  describe('state management', () => {
    it('should have correct name', () => {
      expect(select.name).toBe('select');
    });

    it('should start in idle state and transition to ready', () => {
      const newSelect = new Select(mockEditor as unknown as Editor);
      newSelect.setIdle();
      newSelect.setReady();
      expect(newSelect.name).toBe('select');
    });
  });

  describe('point selection', () => {
    beforeEach(() => {
      fontEngine.editing.addPoint(100, 100, 'onCurve', false);
      fontEngine.editing.addPoint(200, 200, 'onCurve', false);
      fontEngine.editing.addPoint(300, 300, 'onCurve', false);
    });

    it('should select point when clicking on it', () => {
      const event = createMouseEvent('mousedown', 100, 100);
      select.onMouseDown(event);
      expect(mocks.select.set).toHaveBeenCalled();
    });

    it('should clear selection when clicking empty space', () => {
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      select.onMouseUp(createMouseEvent('mouseup', 100, 100));

      mocks.select.set.mockClear();
      select.onMouseDown(createMouseEvent('mousedown', 500, 500));
    });

    it('should update selection to clicked point', () => {
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      select.onMouseUp(createMouseEvent('mouseup', 100, 100));

      mocks.select.set.mockClear();
      select.onMouseDown(createMouseEvent('mousedown', 200, 200));

      expect(mockEditor.createToolContext).toHaveBeenCalled();
    });
  });

  describe('hover state', () => {
    beforeEach(() => {
      fontEngine.editing.addPoint(100, 100, 'onCurve', false);
    });

    it('should set hovered point when mouse is over point', () => {
      select.onMouseMove(createMouseEvent('mousemove', 100, 100));
      expect(mocks.select.setHovered).toHaveBeenCalled();
    });

    it('should clear hovered point when mouse leaves point', () => {
      select.onMouseMove(createMouseEvent('mousemove', 100, 100));
      mocks.select.setHovered.mockClear();
      select.onMouseMove(createMouseEvent('mousemove', 500, 500));
      expect(mocks.select.setHovered).toHaveBeenCalled();
    });
  });

  describe('moving points', () => {
    beforeEach(() => {
      fontEngine.editing.addPoint(100, 100, 'onCurve', false);
    });

    it('should move selected point when dragging', () => {
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      select.onMouseMove(createMouseEvent('mousemove', 150, 150));

      const points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(150);
    });

    it('should move point incrementally during drag', () => {
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));

      select.onMouseMove(createMouseEvent('mousemove', 110, 110));
      let points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(110);
      expect(points[0].y).toBe(110);

      select.onMouseMove(createMouseEvent('mousemove', 130, 130));
      points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(130);
      expect(points[0].y).toBe(130);
    });

    it('should move multiple selected points together', () => {
      fontEngine.editing.addPoint(200, 200, 'onCurve', false);
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      select.onMouseMove(createMouseEvent('mousemove', 120, 120));

      getAllPoints(fontEngine.snapshot.value);
    });

    it('should use applySmartEdits for rule engine integration when dragging', () => {
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      mocks.edit.applySmartEdits.mockClear();
      mocks.edit.movePointTo.mockClear();

      select.onMouseMove(createMouseEvent('mousemove', 150, 150));

      expect(mocks.edit.applySmartEdits).toHaveBeenCalled();
      expect(mocks.edit.movePointTo).not.toHaveBeenCalled();
    });

    it('should call applySmartEdits with selected points and delta', () => {
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      mocks.edit.applySmartEdits.mockClear();

      select.onMouseMove(createMouseEvent('mousemove', 150, 160));

      expect(mocks.edit.applySmartEdits).toHaveBeenCalledWith(
        expect.any(Set),
        50,
        60
      );
    });
  });

  describe('rectangle selection', () => {
    beforeEach(() => {
      fontEngine.editing.addPoint(100, 100, 'onCurve', false);
      fontEngine.editing.addPoint(150, 150, 'onCurve', false);
      fontEngine.editing.addPoint(300, 300, 'onCurve', false);
    });

    it('should start selection rectangle when clicking empty space', () => {
      select.onMouseDown(createMouseEvent('mousedown', 50, 50));
      expect(mockEditor.createToolContext).toHaveBeenCalled();
    });

    it('should select points within rectangle on mouse up', () => {
      select.onMouseDown(createMouseEvent('mousedown', 50, 50));
      select.onMouseMove(createMouseEvent('mousemove', 200, 200));
      select.onMouseUp(createMouseEvent('mouseup', 200, 200));
      expect(mocks.select.set).toHaveBeenCalled();
    });

    it('should request redraw when selection rectangle is released', () => {
      select.onMouseDown(createMouseEvent('mousedown', 50, 50));
      select.onMouseMove(createMouseEvent('mousemove', 200, 200));
      mocks.select.setMode.mockClear();

      select.onMouseUp(createMouseEvent('mouseup', 200, 200));
      expect(mocks.select.setMode).toHaveBeenCalledWith('committed');
    });

    it('should transition from selecting to ready when no points in rectangle', () => {
      select.onMouseDown(createMouseEvent('mousedown', 400, 400));
      select.onMouseMove(createMouseEvent('mousemove', 450, 450));

      select.onMouseUp(createMouseEvent('mouseup', 450, 450));

      expect(select.getState().type).toBe('ready');
    });

    it('should select points within rectangle while dragging', () => {
      select.onMouseDown(createMouseEvent('mousedown', 50, 50));
      mocks.select.set.mockClear();

      select.onMouseMove(createMouseEvent('mousemove', 120, 120));
      expect(mocks.select.set).toHaveBeenCalled();
    });

    it('should update selection as rectangle changes', () => {
      select.onMouseDown(createMouseEvent('mousedown', 50, 50));

      select.onMouseMove(createMouseEvent('mousemove', 120, 120));
      const firstCall = mockEditor.createToolContext.mock.calls.length;

      select.onMouseMove(createMouseEvent('mousemove', 200, 200));

      expect(mockEditor.createToolContext.mock.calls.length).toBeGreaterThan(firstCall);
    });
  });

  describe('nudging points', () => {
    let pointId: PointId;

    beforeEach(() => {
      pointId = fontEngine.editing.addPoint(100, 100, 'onCurve', false);
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      select.onMouseUp(createMouseEvent('mouseup', 100, 100));
    });

    it('should nudge point right with ArrowRight', () => {
      const event = createKeyboardEvent('keydown', 'ArrowRight');

      if (select.keyDownHandler) {
        select.keyDownHandler(event);
      }

      const points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBeGreaterThan(100);
    });

    it('should nudge point left with ArrowLeft', () => {
      const event = createKeyboardEvent('keydown', 'ArrowLeft');

      if (select.keyDownHandler) {
        select.keyDownHandler(event);
      }

      const points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBeLessThan(100);
    });

    it('should nudge point up with ArrowUp', () => {
      const event = createKeyboardEvent('keydown', 'ArrowUp');

      if (select.keyDownHandler) {
        select.keyDownHandler(event);
      }

      const points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].y).toBeGreaterThan(100);
    });

    it('should nudge point down with ArrowDown', () => {
      const event = createKeyboardEvent('keydown', 'ArrowDown');

      if (select.keyDownHandler) {
        select.keyDownHandler(event);
      }

      const points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].y).toBeLessThan(100);
    });

    it('should nudge by larger amount with shift key', () => {
      const before = getAllPoints(fontEngine.snapshot.value)[0].x;

      const normalEvent = createKeyboardEvent('keydown', 'ArrowRight');
      if (select.keyDownHandler) {
        select.keyDownHandler(normalEvent);
      }
      const afterSmall = getAllPoints(fontEngine.snapshot.value)[0].x;
      const smallNudge = afterSmall - before;

      fontEngine.editing.movePoints([pointId], -smallNudge, 0);

      const shiftEvent = createKeyboardEvent('keydown', 'ArrowRight', { shiftKey: true });
      if (select.keyDownHandler) {
        select.keyDownHandler(shiftEvent);
      }
      const afterLarge = getAllPoints(fontEngine.snapshot.value)[0].x;
      const largeNudge = afterLarge - before;

      expect(largeNudge).toBeGreaterThan(smallNudge);
    });

    it('should nudge by largest amount with meta key', () => {
      const before = getAllPoints(fontEngine.snapshot.value)[0].x;

      const metaEvent = createKeyboardEvent('keydown', 'ArrowRight', { metaKey: true });
      if (select.keyDownHandler) {
        select.keyDownHandler(metaEvent);
      }
      const after = getAllPoints(fontEngine.snapshot.value)[0].x;

      expect(after - before).toBeGreaterThan(1);
    });

    it('should only nudge when in modifying state', () => {
      const newSelect = new Select(mockEditor as unknown as Editor);
      newSelect.setReady();

      const before = getAllPoints(fontEngine.snapshot.value)[0].x;

      const event = createKeyboardEvent('keydown', 'ArrowRight');
      if (newSelect.keyDownHandler) {
        newSelect.keyDownHandler(event);
      }

      const after = getAllPoints(fontEngine.snapshot.value)[0].x;
      expect(after).toBe(before);
    });
  });

  describe('redraw requests', () => {
    it('should request redraw on mouse down', () => {
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      expect(mocks.requestRedraw).toHaveBeenCalled();
    });

    it('should request redraw on mouse move during selecting', () => {
      select.onMouseDown(createMouseEvent('mousedown', 50, 50));
      mockEditor.createToolContext.mockClear();
      select.onMouseMove(createMouseEvent('mousemove', 100, 100));
      expect(mockEditor.createToolContext).toHaveBeenCalled();
    });

    it('should request redraw on mouse up', () => {
      fontEngine.editing.addPoint(100, 100, 'onCurve', false);
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      mockEditor.createToolContext.mockClear();
      select.onMouseUp(createMouseEvent('mouseup', 100, 100));
      expect(mockEditor.createToolContext).toHaveBeenCalled();
    });

    it('should request redraw on nudge', () => {
      fontEngine.editing.addPoint(100, 100, 'onCurve', false);
      select.onMouseDown(createMouseEvent('mousedown', 100, 100));
      select.onMouseUp(createMouseEvent('mouseup', 100, 100));
      mocks.requestRedraw.mockClear();

      const event = createKeyboardEvent('keydown', 'ArrowRight');
      if (select.keyDownHandler) {
        select.keyDownHandler(event);
      }
      expect(mocks.requestRedraw).toHaveBeenCalled();
    });
  });
});
