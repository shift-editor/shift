# Commands

Command pattern implementation providing undo/redo for all glyph editing operations.

## Architecture Invariants

- **Architecture Invariant:** Commands mutate the glyph exclusively through `CommandContext.glyph` (the reactive `Glyph` model). They never touch the native bridge directly.
- **Architecture Invariant:** Every command must be self-contained for undo. `execute` must capture enough state (original positions, snapshot, etc.) so that `undo` can fully reverse the operation without external help.
- **Architecture Invariant:** `CompositeCommand` undoes children in reverse order. Commands grouped via `beginBatch`/`endBatch` are auto-wrapped in a `CompositeCommand` at `endBatch` time.
- **Architecture Invariant:** `record` adds a command to the undo stack without calling `execute`. This is the correct path for incremental operations (e.g. drag) where mutations have already been applied live. **CRITICAL:** Using `execute` instead of `record` for already-applied mutations will double-apply them.
- **Architecture Invariant:** New commands that execute clears the redo stack. This is standard command-pattern semantics -- there is no branching history.
- **Architecture Invariant:** Batches cannot nest. Calling `beginBatch` while already batching throws.

## Codemap

```
commands/
  core/
    Command.ts          # Command interface, BaseCommand, CompositeCommand
    CommandHistory.ts    # Undo/redo stacks, batching, reactive signals
  primitives/
    PointCommands.ts     # AddPointCommand
    BezierCommands.ts    # CloseContourCommand, NudgePointsCommand, SetActiveContourCommand,
                         #   ReverseContourCommand, SplitSegmentCommand, UpgradeLineToCubicCommand
    SetNodePositionsCommand.ts  # Efficient bulk position updates (before/after lists)
    SnapshotCommand.ts   # Whole-glyph snapshot undo (catch-all)
    SidebearingCommands.ts  # SetXAdvanceCommand, SetLeftSidebearingCommand, SetRightSidebearingCommand
  transform/
    TransformCommands.ts    # RotatePointsCommand, ScalePointsCommand, ReflectPointsCommand, MoveSelectionToCommand
    AlignmentCommands.ts    # AlignPointsCommand, DistributePointsCommand
  clipboard/
    ClipboardCommands.ts    # CutCommand, PasteCommand
```

## Key Types

- **`Command<TResult>`** -- Interface: `name`, `execute(ctx)`, `undo(ctx)`, `redo(ctx)`. All commands implement this.
- **`CommandContext`** -- `{ readonly glyph: Glyph }`. Injected into every command method. Provides access to all glyph mutation methods.
- **`BaseCommand<TResult>`** -- Abstract class implementing `Command`. Default `redo` calls `execute`; subclasses override when redo needs different logic (e.g. snapshot-based replay).
- **`CompositeCommand`** -- Groups multiple commands into one undo step. Executes children in order, undoes in reverse.
- **`CommandHistory`** -- Manages undo/redo stacks. Exposes `execute`, `record`, `undo`, `redo`, `clear`, batching (`beginBatch`/`endBatch`/`withBatch`), and reactive signals (`canUndo`, `canRedo`).
- **`CommandHistoryOptions`** -- `{ maxHistory?: number; onDirty?: () => void }`. `maxHistory` defaults to 100.
- **`SnapshotCommand`** -- Stores before/after `GlyphSnapshot`. Catch-all for complex operations where fine-grained undo is impractical (e.g. boolean operations).
- **`SetNodePositionsCommand`** -- Stores before/after `NodePositionUpdateList`. Efficient path for move-only operations avoiding full snapshot overhead. Has static factories `fromBaseGlyphAndUpdates` and `fromGlyphDiff`.
- **`BaseTransformCommand`** -- Abstract template in `TransformCommands.ts`. Captures original positions on first execute; subclasses implement `transformPoints`. Used by `RotatePointsCommand`, `ScalePointsCommand`, `ReflectPointsCommand`, `MoveSelectionToCommand`.

## How it works

### Two-stack undo/redo

`CommandHistory` maintains an undo stack and a redo stack. `execute(cmd)` runs the command and pushes it onto the undo stack, clearing the redo stack. `undo()` pops from undo, calls `cmd.undo(ctx)`, and pushes onto redo. `redo()` does the reverse.

### execute vs record

- **`execute(cmd)`** -- Calls `cmd.execute(ctx)`, then pushes to undo stack. Use for discrete one-shot operations (add point, nudge, transform).
- **`record(cmd)`** -- Pushes to undo stack without calling execute. Use when mutations have already been applied incrementally (e.g. dragging points). The editor's `startNodeDrag` pattern applies live position updates during the drag, then calls `record(SetNodePositionsCommand.fromBaseGlyphAndUpdates(...))` at drag end.

### Batching

Multiple commands can be grouped into a single undo step using `withBatch(name, fn)` (preferred) or the manual `beginBatch`/`endBatch` pair. Commands executed during a batch are collected and wrapped in a `CompositeCommand` at `endBatch`. If only one command was batched, it is pushed directly without wrapping. `cancelBatch` discards the batch state but does not roll back already-executed commands.

### Command undo strategies

Commands use one of three strategies depending on cost:

1. **Delta-based** -- Store the delta, apply inverse on undo. Used by `NudgePointsCommand`.
2. **Position-capture** -- Store original positions, restore on undo. Used by `BaseTransformCommand` subclasses, `AlignPointsCommand`, `DistributePointsCommand`, `SplitSegmentCommand`.
3. **Snapshot-based** -- Store full `GlyphSnapshot` before/after. Used by `SnapshotCommand`, `CutCommand`, `PasteCommand`. Most expensive but handles topology changes (adding/removing contours).

`SetNodePositionsCommand` is a hybrid: it stores before/after position lists (cheaper than full snapshots) and replays them on undo/redo.

### Reactive UI

`canUndo` and `canRedo` are `ComputedSignal<boolean>` derived from `undoCount`/`redoCount` writable signals. These update after every stack mutation, enabling reactive UI binding for undo/redo button state. `getUndoLabel()`/`getRedoLabel()` return the next command's `name` for menu display.

### Dirty tracking

`CommandHistoryOptions.onDirty` fires after every `execute` or `record` call, allowing the editor to mark the document as unsaved.

## Workflow recipes

### Adding a new command

1. Create a class extending `BaseCommand<TResult>` (or implementing `Command<TResult>` directly).
2. Set `readonly name` to a human-readable label (shown in undo/redo menus).
3. Implement `execute(ctx)` -- perform the mutation via `ctx.glyph.*` methods and capture any state needed for undo.
4. Implement `undo(ctx)` -- fully reverse the mutation.
5. Override `redo(ctx)` only if re-executing from scratch would fail (e.g. id drift after point removal). Default `redo` calls `execute`.
6. Export from the appropriate subdirectory's `index.ts` and from the top-level `commands/index.ts`.
7. Wire it in `Editor` or a tool -- call `commandHistory.execute(new YourCommand(...))` or `commandHistory.record(...)`.
8. Add tests covering execute, undo, and redo round-trips.

### Adding a transform command

1. Extend `BaseTransformCommand` instead of `BaseCommand`.
2. Implement `transformPoints(points)` -- receives original positions, returns transformed positions.
3. Position capture and undo/redo are handled by the base class automatically.

## Gotchas

- `SnapshotCommand` does not extend `BaseCommand` -- it implements `Command` directly (its `@knipclassignore` annotation prevents dead-code detection from flagging it, since it is only instantiated dynamically).
- `SetLeftSidebearingCommand` moves all geometry (`translateLayer`) in addition to changing `xAdvance`. Undo must reverse both, and the order matters (restore advance first, then translate back).
- `SplitSegmentCommand.redo` resets internal state (`#insertedPointIds`, `#originalPositions`) before re-executing because point ids are engine-assigned and differ across executions.
- `PasteCommand` captures a full after-snapshot on first execute and uses snapshot restore for redo, avoiding id-drift issues from creating new contours/points twice.
- `cancelBatch` does not undo already-executed commands -- it only discards the batch bookkeeping. Callers must handle rollback separately if needed.

## Verification

```bash
# Run command tests
npx vitest run --project renderer src/lib/commands/

# Run editor integration tests (exercises command wiring)
npx vitest run --project renderer src/lib/editor/
```

## Related

- `Glyph` -- Reactive glyph model; all commands mutate through `ctx.glyph`
- `Editor` -- Orchestrates command execution; owns the `CommandHistory` instance
- `Signal`, `ComputedSignal` -- Reactive primitives powering `canUndo`/`canRedo`
- `GlyphSnapshot` -- Serialized glyph state used by `SnapshotCommand` and snapshot-based undo
- `NodePositionUpdateList` -- Typed position update lists used by `SetNodePositionsCommand`
- `Transform` -- Pure math functions for rotate/scale/reflect, consumed by transform commands
- `Alignment` -- Pure math for align/distribute, consumed by `AlignPointsCommand`/`DistributePointsCommand`
