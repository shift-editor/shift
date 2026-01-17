# Commands

Command pattern implementation providing undo/redo functionality for all editing operations.

## Overview

The commands library implements a classic command pattern with undo/redo stacks, composite commands for grouping operations, and reactive signals for UI state. Commands encapsulate mutations and their reversals, enabling reliable history management.

## Architecture

```
CommandHistory
├── #undoStack: Command[]
├── #redoStack: Command[]
├── undoCount: WritableSignal<number>
├── redoCount: WritableSignal<number>
├── canUndo: ComputedSignal<boolean>
└── canRedo: ComputedSignal<boolean>

Command Interface
├── execute(ctx) → TResult
├── undo(ctx)
└── redo(ctx)

CompositeCommand
└── #commands: Command[]  (executes in order, undoes in reverse)
```

### Key Design Decisions

1. **Two-Stack Pattern**: Separate undo and redo stacks with classic semantics
2. **Context Injection**: Commands receive FontEngine via CommandContext
3. **Composite Pattern**: Group multiple commands into single undoable unit
4. **Reactive State**: Signals for canUndo/canRedo enable reactive UI

## Key Concepts

### Command Interface

All commands implement this contract:

```typescript
interface Command<TResult = void> {
  readonly name: string;           // Human-readable label
  execute(ctx: CommandContext): TResult;
  undo(ctx: CommandContext): void;
  redo(ctx: CommandContext): TResult;
}
```

### CommandContext

Provides access to the editing system:

```typescript
interface CommandContext {
  readonly fontEngine: FontEngine;
  readonly snapshot: GlyphSnapshot | null;
}
```

### CompositeCommand

Groups commands into atomic operations:

```typescript
const composite = new CompositeCommand('Add Bezier Curve', [
  new AddPointCommand(x1, y1, 'onCurve'),
  new AddPointCommand(cx, cy, 'offCurve'),
  new AddPointCommand(x2, y2, 'onCurve'),
]);

history.execute(composite);
history.undo(); // Undoes all three in reverse order
```

## API Reference

### CommandHistory
- `execute<T>(cmd): T` - Execute and push to undo stack
- `undo(): void` - Undo last command
- `redo(): void` - Redo last undone command
- `clear(): void` - Clear both stacks
- `getUndoLabel(): string | undefined` - Name of next undo
- `getRedoLabel(): string | undefined` - Name of next redo
- `canUndo: ComputedSignal<boolean>` - Reactive undo availability
- `canRedo: ComputedSignal<boolean>` - Reactive redo availability

### Point Commands
- `AddPointCommand` - Add point to contour
- `MovePointsCommand` - Move points by delta
- `MovePointToCommand` - Move point to absolute position
- `RemovePointsCommand` - Remove points

### Bezier Commands
- `AddBezierAnchorCommand` - Add smooth anchor with handles
- `CloseContourCommand` - Close active contour
- `AddContourCommand` - Create new contour
- `NudgePointsCommand` - Small arrow-key movements

## Usage Examples

### Basic Undo/Redo
```typescript
const history = new CommandHistory(fontEngine, () => snapshot);

// Execute command
history.execute(new MovePointsCommand([pointId], 50, 0));

// Undo the move
history.undo();

// Redo the move
history.redo();
```

### Reactive UI Binding
```typescript
effect(() => {
  undoButton.disabled = !history.canUndo.value;
  redoButton.disabled = !history.canRedo.value;
});
```

### Composite Operations
```typescript
const addBezier = new AddBezierAnchorCommand(100, 200, 150, 250);
history.execute(addBezier);

// Access created point IDs
const anchorId = addBezier.anchorId;
const leadingId = addBezier.leadingId;
const trailingId = addBezier.trailingId;
```

### Custom Command
```typescript
class ScalePointsCommand extends BaseCommand {
  readonly name = 'Scale Points';
  #pointIds: PointId[];
  #scale: number;
  #originalPositions: Map<PointId, Point2D>;

  execute(ctx: CommandContext): void {
    // Store original positions for undo
    this.#originalPositions = new Map();
    for (const id of this.#pointIds) {
      const point = findPoint(ctx.snapshot, id);
      this.#originalPositions.set(id, { x: point.x, y: point.y });
    }
    // Apply scale...
  }

  undo(ctx: CommandContext): void {
    // Restore original positions
  }
}
```

## Data Flow

```
User Action (e.g., drag point)
    ↓
Create Command (MovePointsCommand)
    ↓
history.execute(command)
    ├── command.execute(ctx)
    │   ├── Mutate via fontEngine
    │   └── Store state for undo
    ├── Push to undoStack
    └── Clear redoStack
    ↓
history.undo()
    ├── Pop from undoStack
    ├── command.undo(ctx)
    └── Push to redoStack
```

## Related Systems

- [engine](../../engine/docs/DOCS.md) - FontEngine for mutations
- [reactive](../reactive/docs/DOCS.md) - Signals for state
- [editor](../editor/docs/DOCS.md) - Orchestrates command execution
- [tools](../tools/docs/DOCS.md) - Tools create commands
