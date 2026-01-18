# Tools - LLM Context

## Quick Facts
- **Purpose**: State machine-based editing tools (Pen, Select, Hand, Shape)
- **Language**: TypeScript
- **Key Files**: `core/StateMachine.ts`, `pen/Pen.ts`, `select/Select.ts`, `Hand.ts`, `Shape.ts`
- **Dependencies**: lib/reactive, lib/editor, lib/commands
- **Dependents**: views/Editor.tsx

## File Structure
```
src/renderer/src/lib/tools/
├── core/
│   ├── StateMachine.ts      # Generic state machine
│   ├── StateMachine.test.ts
│   └── index.ts
├── pen/
│   ├── Pen.ts               # Pen tool class
│   ├── states.ts            # PenState types
│   ├── commands.ts          # Bezier operations
│   └── index.ts
├── select/
│   ├── Select.ts            # Select tool class
│   ├── states.ts            # SelectState types
│   ├── commands.ts          # Selection operations
│   └── index.ts
├── Hand.ts                  # Pan tool
├── Shape.ts                 # Rectangle tool
├── tools.ts                 # Tool registry
├── Pen.test.ts
└── Select.test.ts
```

## Core Abstractions

### StateMachine<TState> (core/StateMachine.ts)
```typescript
interface StateMachine<TState extends { type: string }> {
  readonly state: WritableSignal<TState>;
  readonly currentType: TState['type'];
  readonly current: TState;

  transition(newState: TState): void;
  isIn<T extends TState['type']>(...types: T[]): boolean;
  when<T extends TState['type']>(type: T, handler: (state) => void): void;
  match<R>(handlers: { [K in TState['type']]?: (state) => R }): R | undefined;
}
```

### PenState (pen/states.ts)
```typescript
type PenState =
  | { type: 'idle' }
  | { type: 'ready' }
  | { type: 'anchored'; anchor: AnchorData }
  | { type: 'dragging'; anchor: AnchorData; handles: HandleData; mousePos: Point2D };

interface AnchorData {
  position: Point2D;
  pointId: PointId;
  contourContext: ContourContext;
}
```

### SelectState (select/states.ts)
```typescript
type SelectState =
  | { type: 'idle' }
  | { type: 'ready'; hoveredPointId: PointId | null }
  | { type: 'selecting'; selection: SelectionData }
  | { type: 'selected'; hoveredPointId: PointId | null }
  | { type: 'dragging'; drag: DragData };

interface DragData {
  anchorPointId: PointId;
  startPos: Point2D;
  currentPos: Point2D;
}
```

### Tool Interface (types/tool.ts)
```typescript
interface Tool {
  name: ToolName;
  setIdle(): void;
  setReady(): void;
  onMouseDown(e: MouseEvent): void;
  onMouseUp(e: MouseEvent): void;
  onMouseMove(e: MouseEvent): void;
  keyDownHandler?(e: KeyboardEvent): void;
  keyUpHandler?(e: KeyboardEvent): void;
  onDoubleClick?(e: MouseEvent): void;
  drawInteractive?(ctx: IRenderer): void;
  dispose?(): void;
}
```

## Key Patterns

### State Machine with Signals
```typescript
class Select implements Tool {
  #sm = createStateMachine<SelectState>({ type: 'idle' });

  #renderEffect = effect(() => {
    if (!this.#sm.isIn('idle')) {
      this.#editor.requestRedraw();
    }
  });

  onMouseDown(e: MouseEvent): void {
    this.#sm.when('ready', (state) => {
      if (state.hoveredPointId) {
        this.#sm.transition({ type: 'selected', hoveredPointId: state.hoveredPointId });
      }
    });
  }
}
```

### Commands Separation
```typescript
// pen/commands.ts - Pure geometry operations
export const PenCommands = {
  placeAnchor(pos: Point2D): AnchorData { /* ... */ },
  createHandles(anchor: AnchorData, mousePos: Point2D): HandleData { /* ... */ },
  updateHandles(anchor: AnchorData, handles: HandleData, mousePos: Point2D): void { /* ... */ },
};

// Pen.ts - Uses commands
onMouseDown(e) {
  const anchor = PenCommands.placeAnchor(pos);
  this.#sm.transition({ type: 'anchored', anchor });
}
```

### Tool Context Usage
```typescript
class Pen implements Tool {
  onMouseMove(e: MouseEvent): void {
    const ctx = this.#editor.createToolContext();
    const upmPos = ctx.viewport.projectScreenToUpm(e.clientX, e.clientY);

    this.#sm.when('dragging', (state) => {
      PenCommands.updateHandles(state.anchor, state.handles, upmPos);
      ctx.requestRedraw();
    });
  }
}
```

## API Surface

| Tool | States | Key Methods |
|------|--------|-------------|
| Select | idle, ready, selecting, selected, dragging | hitTest, selectPoint, moveSelectedPoints |
| Pen | idle, ready, anchored, dragging | placeAnchor, createHandles, updateHandles |
| Hand | idle, ready, dragging | pan viewport |
| Shape | idle, ready, dragging | create rectangle |

## Common Operations

### Create and use state machine
```typescript
const sm = createStateMachine<MyState>({ type: 'idle' });
sm.transition({ type: 'active', data: 123 });
if (sm.isIn('active')) {
  sm.when('active', (s) => console.log(s.data));
}
```

### Tool event handling
```typescript
onMouseDown(e: MouseEvent): void {
  const pos = this.#editor.projectScreenToUpm(e.clientX, e.clientY);

  this.#sm.match({
    ready: () => this.startAction(pos),
    selected: () => this.beginDrag(pos),
  });
}
```

### Interactive drawing
```typescript
drawInteractive(ctx: IRenderer): void {
  this.#sm.when('selecting', (state) => {
    const { start, current } = state.selection;
    ctx.strokeRect(start.x, start.y, current.x - start.x, current.y - start.y);
  });
}
```

## Constants

```typescript
// Pen
const DRAG_THRESHOLD = 3;      // UPM units before handles created
const CLOSE_HIT_RADIUS = 8;    // Detect close click

// Select
const HIT_RADIUS = 4;          // Point hit detection
const DRAG_THRESHOLD = 2;      // UPM units before drag
```

## Constraints and Invariants

1. **State Exhaustiveness**: State machine transitions must handle all states
2. **Idle on Deactivate**: Tools transition to 'idle' when setIdle() called
3. **Effect Cleanup**: Tools dispose() their effects
4. **UPM Coordinates**: All tool operations work in UPM space
5. **Single Active Tool**: Only one tool receives events at a time
6. **Keyboard Shortcuts**: V=Select, P=Pen, H=Hand, S=Shape
