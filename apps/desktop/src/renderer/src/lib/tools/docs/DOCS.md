# Tools

State machine-based tool implementations for the Shift font editor.

## Overview

The tools library provides editing tools (Pen, Select, Hand, Shape) built on a generic state machine pattern. Each tool manages its own state, handles mouse/keyboard events, and renders interactive overlays. Tools are coordinated through a registry system with keyboard shortcuts.

## Architecture

```
Tool Interface
├── name: ToolName
├── setIdle() / setReady()
├── onMouseDown/Move/Up()
├── keyDownHandler?() / keyUpHandler?()
├── drawInteractive?(ctx)
├── dispose?()
└── cancel?()

StateMachine<TState>
├── state: WritableSignal<TState>
├── transition(newState)
├── isIn(...types): boolean
├── when(type, handler)
└── match(handlers)

Tool Registry
└── Map<ToolName, { tool, icon, tooltip }>
```

### Key Design Decisions

1. **State Machine Pattern**: Each tool uses discriminated union states
2. **Separation of Concerns**: States define WHEN, commands define HOW
3. **Reactive State**: State machine uses signals for automatic redraws
4. **Tool Context**: Editor provides context for tool operations

## Key Concepts

### Tool Interface

All tools implement this contract:

```typescript
interface Tool {
  name: ToolName; // 'select' | 'pen' | 'hand' | 'shape'
  setIdle(): void;
  setReady(): void;
  onMouseDown(e: MouseEvent): void;
  onMouseUp(e: MouseEvent): void;
  onMouseMove(e: MouseEvent): void;
  keyDownHandler?(e: KeyboardEvent): void;
  drawInteractive?(ctx: IRenderer): void;
  cancel?(): void; // Called on Escape key
}
```

### State Machine

Generic state management with type-safe transitions:

```typescript
const sm = createStateMachine<PenState>({ type: "idle" });

sm.transition({ type: "ready" });
sm.isIn("ready", "idle"); // true
sm.when("ready", (state) => {
  /* handle ready */
});
```

### Tool Context

Provided by editor for tool operations:

```typescript
interface ToolContext {
  snapshot: GlyphSnapshot | null;
  selectedPoints: ReadonlySet<PointId>;
  viewport: Viewport;
  mousePosition: Point2D;
  fontEngine: FontEngine;
  commands: CommandHistory;
  setSelectedPoints(ids: Set<PointId>): void;
  requestRedraw(): void;
}
```

## Tool Implementations

### Select Tool

Point selection and dragging:

```
States: idle → ready ↔ selected
              ↓         ↑
           selecting → dragging
```

Features:

- Click to select point
- Shift+click for multi-select
- Drag to move selected points
- Rectangle selection
- Arrow keys for nudging

### Pen Tool

Bezier curve drawing:

```
States: idle → ready → anchored → dragging → ready
```

Features:

- Click to place anchor
- Drag to create handles
- Automatic handle mirroring
- Click first point to close contour

### Hand Tool

Canvas panning:

```
States: idle → ready → dragging
```

Features:

- Drag to pan canvas
- Space bar activation

### Shape Tool

Rectangle creation:

```
States: idle → ready → dragging
```

Features:

- Drag to create rectangle
- Auto-closes contour

## API Reference

### StateMachine<TState>

- `state: WritableSignal<TState>` - Current state signal
- `current: TState` - Current state value
- `currentType: string` - Current state type
- `transition(newState)` - Change state
- `isIn(...types): boolean` - Check state
- `when(type, handler)` - Execute if in state
- `match(handlers): R` - Pattern match states

### Tool Registry

- `createToolRegistry(editor)` - Initialize all tools
- `tools.get(name): ToolRegistryItem` - Get tool

### Keyboard Shortcuts

- `V` - Select tool
- `P` - Pen tool
- `H` - Hand tool
- `S` - Shape tool
- `Escape` - Cancel current operation

### Cancel System

All tools support the Escape key for cancellation via the optional `cancel()` method.

**Behavior:**
- Escape cancels the current in-progress operation
- Progressive: cancels one level at a time
- Command batches are cancelled (not committed)

**Per-tool behavior:**

| Tool | Cancel Action |
|------|---------------|
| Pen | Cancel point placement → abandon contour |
| Select | Cancel drag → clear selection → ready |
| Shape | Cancel rectangle preview |
| Hand | Stop panning |

**Implementation pattern:**
```typescript
cancel(): void {
  // 1. Check for in-progress operation
  if (this.#sm.isIn("dragging")) {
    if (ctx.commands.isBatching) {
      ctx.commands.cancelBatch();
    }
    this.#sm.transition({ type: "ready" });
    return;
  }
  // 2. Tool-specific idle cleanup
}
```

## Usage Examples

### Using a Tool

```typescript
const pen = new Pen(editor);
pen.setReady(); // Activate

// Events handled automatically via editor:
canvas.onMouseDown = (e) => pen.onMouseDown(e);
canvas.onMouseMove = (e) => pen.onMouseMove(e);
canvas.onMouseUp = (e) => pen.onMouseUp(e);
```

### State Machine Usage

```typescript
const sm = createStateMachine<SelectState>({ type: "idle" });

sm.transition({ type: "ready", hoveredPointId: null });

sm.when("dragging", (state) => {
  const { drag } = state;
  movePoints(drag.pointIds, drag.dx, drag.dy);
});

sm.match({
  idle: () => (cursor = "default"),
  ready: () => (cursor = "crosshair"),
  dragging: () => (cursor = "grabbing"),
});
```

### Tool Commands

```typescript
// Pen commands
const anchor = PenCommands.placeAnchor(pos);
const handles = PenCommands.createHandles(anchor, mousePos);
PenCommands.updateHandles(anchor, handles, mousePos);

// Select commands
const hit = SelectCommands.hitTest(pos);
SelectCommands.selectPoint(pointId, additive);
SelectCommands.moveSelectedPoints(anchorId, currentPos);
```

## Data Flow

```
Mouse Event
    ↓
Tool.onMouseMove(e)
    ↓
Get UPM position from editor
    ↓
State machine logic
    ├── Match current state
    ├── Execute state-specific logic
    └── Transition to new state
    ↓
Commands execute mutations
    ↓
Request redraw
    ↓
drawInteractive() called
    ↓
Tool renders overlays
```

## Related Systems

- [editor](../editor/docs/DOCS.md) - Provides ToolContext
- [commands](../commands/docs/DOCS.md) - Command execution
- [reactive](../reactive/docs/DOCS.md) - State signals
- [graphics](../graphics/docs/DOCS.md) - Interactive rendering
