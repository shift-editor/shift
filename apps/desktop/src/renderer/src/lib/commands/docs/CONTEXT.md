# Commands - LLM Context

## Quick Facts

- **Purpose**: Command pattern with undo/redo for editing operations
- **Language**: TypeScript
- **Key Files**: `Command.ts`, `CommandHistory.ts`, `PointCommands.ts`, `BezierCommands.ts`
- **Dependencies**: lib/reactive (signals), engine (FontEngine)
- **Dependents**: lib/editor, lib/tools

## File Structure

```
src/renderer/src/lib/commands/
├── index.ts              # Public exports
├── Command.ts            # Command interface, BaseCommand, CompositeCommand
├── CommandHistory.ts     # Undo/redo stack management
├── PointCommands.ts      # Point mutation commands
├── BezierCommands.ts     # Bezier-specific commands
├── CommandHistory.test.ts
├── PointCommands.test.ts
└── BezierCommands.test.ts
```

## Core Abstractions

### Command Interface (Command.ts:34-55)

```typescript
interface Command<TResult = void> {
  readonly name: string;
  execute(ctx: CommandContext): TResult;
  undo(ctx: CommandContext): void;
  redo(ctx: CommandContext): TResult;
}

interface CommandContext {
  readonly fontEngine: FontEngine;
  readonly snapshot: GlyphSnapshot | null;
}
```

### BaseCommand (Command.ts:60-73)

```typescript
abstract class BaseCommand<TResult = void> implements Command<TResult> {
  abstract readonly name: string;
  abstract execute(ctx: CommandContext): TResult;
  abstract undo(ctx: CommandContext): void;

  redo(ctx: CommandContext): TResult {
    return this.execute(ctx); // Default: re-execute
  }
}
```

### CompositeCommand (Command.ts:79-106)

```typescript
class CompositeCommand implements Command<void> {
  #commands: Command<unknown>[];

  execute(ctx: CommandContext): void {
    for (const cmd of this.#commands) cmd.execute(ctx);
  }

  undo(ctx: CommandContext): void {
    // REVERSE ORDER for consistency
    for (let i = this.#commands.length - 1; i >= 0; i--) {
      this.#commands[i].undo(ctx);
    }
  }
}
```

### CommandHistory (CommandHistory.ts)

```typescript
class CommandHistory {
  #undoStack: Command<unknown>[] = [];
  #redoStack: Command<unknown>[] = [];
  #maxHistory = 100;

  readonly undoCount: WritableSignal<number>;
  readonly redoCount: WritableSignal<number>;
  readonly canUndo: ComputedSignal<boolean>;
  readonly canRedo: ComputedSignal<boolean>;

  execute<T>(cmd: Command<T>): T {
    const result = cmd.execute(this.#createContext());
    this.#undoStack.push(cmd);
    this.#redoStack = []; // Clear redo on new action
    return result;
  }
}
```

## Key Patterns

### State Storage for Undo

```typescript
class MovePointToCommand extends BaseCommand {
  #originalX?: number;
  #originalY?: number;

  execute(ctx: CommandContext): void {
    // Store original position
    const point = findPoint(ctx.snapshot, this.#pointId);
    this.#originalX = point.x;
    this.#originalY = point.y;
    // Apply move
    ctx.fontEngine.editing.movePointTo(this.#pointId, this.#x, this.#y);
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.editing.movePointTo(
      this.#pointId,
      this.#originalX!,
      this.#originalY!,
    );
  }
}
```

### Inverse Operation

```typescript
class MovePointsCommand extends BaseCommand {
  undo(ctx: CommandContext): void {
    // Move by negative delta
    ctx.fontEngine.editing.movePoints(this.#pointIds, -this.#dx, -this.#dy);
  }
}
```

### Data Snapshot for Restore

```typescript
class RemovePointsCommand extends BaseCommand {
  #removedPoints: Array<{
    contourId: string;
    x: number;
    y: number;
    pointType: PointTypeString;
    smooth: boolean;
  }> = [];

  execute(ctx: CommandContext): void {
    // Store full point data before removal
    for (const id of this.#pointIds) {
      const point = findPoint(ctx.snapshot, id);
      this.#removedPoints.push({ ...point });
    }
    ctx.fontEngine.editing.removePoints(this.#pointIds);
  }
}
```

## API Surface

| Class                  | Method       | Purpose                  |
| ---------------------- | ------------ | ------------------------ |
| CommandHistory         | execute(cmd) | Execute and push to undo |
| CommandHistory         | undo()       | Undo last command        |
| CommandHistory         | redo()       | Redo last undone         |
| CommandHistory         | clear()      | Clear both stacks        |
| AddPointCommand        | execute      | Add point, store ID      |
| MovePointsCommand      | execute      | Move by delta            |
| MovePointToCommand     | execute      | Move to absolute pos     |
| RemovePointsCommand    | execute      | Remove, store data       |
| AddBezierAnchorCommand | execute      | Add anchor + handles     |
| CloseContourCommand    | execute      | Close contour            |
| NudgePointsCommand     | execute      | Small movements          |

## Common Operations

### Execute with history

```typescript
const history = new CommandHistory(fontEngine, () => snapshot);
const cmd = new MovePointsCommand([pointId], 50, 0);
history.execute(cmd);
```

### Undo/redo

```typescript
history.undo();
history.redo();
```

### Check availability

```typescript
if (history.canUndo.value) {
  console.log("Can undo:", history.getUndoLabel());
}
```

### Composite command

```typescript
const composite = new CompositeCommand("Add Rectangle", [
  new AddPointCommand(0, 0, "onCurve", false),
  new AddPointCommand(100, 0, "onCurve", false),
  new AddPointCommand(100, 100, "onCurve", false),
  new AddPointCommand(0, 100, "onCurve", false),
]);
history.execute(composite);
```

## Constraints and Invariants

1. **New Action Clears Redo**: Executing new command clears redo stack
2. **Reverse Undo Order**: CompositeCommand undoes in reverse execution order
3. **Context Fresh**: CommandContext created fresh for each operation
4. **Max History**: Stack trimmed to maxHistory (default 100)
5. **ID Stability**: Some commands (AddPoint) may get new IDs on redo
6. **Session Required**: Commands assume active edit session
