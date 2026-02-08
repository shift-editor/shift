# /wire-rust — Wire a New Rust Command to TypeScript

Use this skill when adding a new editing command that starts in Rust and needs to be callable from the TypeScript app layer. Follow the 5 touchpoints below in order.

## Touchpoints

### 1. Rust Core — `crates/shift-core/src/edit_session.rs`

Add the method to `EditSession`. This is where the actual mutation logic lives.

```rust
pub fn my_command(&mut self, ...) -> Result<Vec<PointId>, String> {
    // mutation logic
}
```

Return types:

- `Vec<PointId>` — affected point IDs (for commands that return them)
- `Result<Vec<PointId>, String>` — fallible with affected IDs
- `()` — no return value needed
- `Result<(), String>` — fallible, no return value

### 2. NAPI Binding — `crates/shift-node/src/font_engine.rs`

Add a `#[napi]` method using one of the 4 command helpers:

| Helper               | Use when                               |
| -------------------- | -------------------------------------- |
| `command`            | Returns `Vec<PointId>`, infallible     |
| `command_simple`     | Returns `()`, infallible               |
| `command_try`        | Returns `Result<Vec<PointId>, String>` |
| `command_try_simple` | Returns `Result<(), String>`           |

```rust
#[napi]
pub fn my_command(&mut self, arg: String) -> Result<String> {
    let parsed = parse_or_err!(arg, MyType, "my type");
    self.command_try(|s| s.my_command(parsed).map(|id| vec![id]))
}
```

Parse string arguments BEFORE the closure (parse_or_err! returns early on failure).
Run `cargo test --package shift-node && cargo clippy && cargo fmt` to verify.

### 3. FontEngineAPI Interface — `apps/desktop/src/shared/bridge/FontEngineAPI.ts`

Add the method signature to the `FontEngineAPI` interface. This is the bridge contract.

```typescript
myCommand(arg: string): string;
```

All command methods return `string` (JSON). The preload auto-forwards automatically — no changes needed there.

### 4. EditingManager — `apps/desktop/src/renderer/src/engine/editing.ts`

Add a one-liner using `#dispatch` or `#dispatchVoid`:

```typescript
// Returns affected point IDs
myCommand(arg: SomeType): PointId[] {
    return this.#dispatch(this.#engine.raw.myCommand(arg));
}

// Void command
myCommand(arg: SomeType): void {
    this.#dispatchVoid(this.#engine.raw.myCommand(arg));
}
```

`#dispatch` and `#dispatchVoid` handle: session check, JSON parse, error throw, glyph emit.

### 5. MockFontEngine — `apps/desktop/src/renderer/src/engine/mock.ts`

Add mock implementation. Use the helpers:

```typescript
myCommand(arg: string): string {
    if (!this.#snapshot) return this.#makeResult(false, [], "No active edit session");

    const contour = this.#findContour(arg);
    if (!contour) return this.#makeResult(false, [], `Contour ${arg} not found`);

    // mock logic
    return this.#makeResult(true, []);
}
```

Available helpers:

- `#withSession(fn)` — throws if no session, calls fn with snapshot
- `#findContour(id)` — returns MockContour or undefined
- `#findPoint(id)` — returns `{ contour, point, index }` or null
- `#makeResult(success, affectedPointIds, error?)` — builds CommandResult JSON

## Zero-Maintenance Layers

These layers require NO changes when adding new commands:

- **Preload** (`apps/desktop/src/preload/preload.ts`) — auto-forwards all FontEngineAPI methods via `buildFontEngineAPI()`
- **FontEngine** (`apps/desktop/src/renderer/src/engine/FontEngine.ts`) — exposes `raw` getter; command methods live in EditingManager

## Verification Checklist

```bash
cargo test --package shift-node && cargo clippy && cargo fmt
pnpm build:native && pnpm typecheck && pnpm test && pnpm lint:check
```
