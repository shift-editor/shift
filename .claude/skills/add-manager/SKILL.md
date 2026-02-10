# /add-manager — Add a New Manager to the Editor

Use this skill when extracting a responsibility from `Editor.ts` into a dedicated manager class, or when adding a new capability that needs its own manager. Follow the 5 touchpoints below in order.

## Reference Examples

Existing managers to use as patterns:

| Manager          | Dep Interface | Has Signals | File                           |
| ---------------- | ------------- | ----------- | ------------------------------ |
| SnapManager      | `Snap`        | No          | `managers/SnapManager.ts`      |
| ClipboardManager | `Clipboard`   | No          | `managers/ClipboardManager.ts` |
| SelectionManager | (none)        | Yes         | `managers/SelectionManager.ts` |
| ViewportManager  | (none)        | Yes         | `managers/ViewportManager.ts`  |
| HoverManager     | (none)        | Yes         | `managers/HoverManager.ts`     |

Managers that coordinate with Editor state need a dep interface. Managers that only own signals (pure state containers) do not.

## Touchpoints

### 1. Dep Interface — `managers/{Name}Manager.ts`

Define a short, single-word interface at the top of the manager file. Use callback functions for reading Editor state — never pass the Editor directly.

```typescript
import type { Glyph } from "@shift/types";

/**
 * Dependency interface for {@link MyManager}.
 */
export interface My {
  getGlyph: () => Glyph | null;
  getSomething: () => SomeType;
}
```

Naming rules:

- Interface name is the **domain noun** — `Snap`, `Clipboard`, `My` — NOT `SnapManagerDeps`
- Use getter callbacks (`getX: () => T`) for values that change over time
- Use direct property access (`readonly commands: CommandHistory`) for stable references
- Use method signatures (`doThing(arg: Foo): void`) for mutation callbacks

### 2. Manager Class — `managers/{Name}Manager.ts`

Create the manager in `lib/editor/managers/`. Constructor takes the dep interface as its sole parameter.

```typescript
export class MyManager {
  readonly #deps: My;

  constructor(deps: My) {
    this.#deps = deps;
  }

  someMethod(): Result {
    const glyph = this.#deps.getGlyph();
    if (!glyph) return null;
    // ...
  }
}
```

Key rules:

- Store deps as `readonly #deps` (hard-private)
- All internal fields use `#` prefix
- No direct import of `Editor`
- If the manager owns signals, expose via read-only getters:

```typescript
readonly #$hoveredId: WritableSignal<PointId | null>;

get hoveredId(): Signal<PointId | null> {
  return this.#$hoveredId;
}
```

### 3. Wire into Editor — `lib/editor/Editor.ts`

Add the manager field and construct it in the Editor constructor with an inline deps object.

```typescript
// Field
readonly #myManager: MyManager;

// In constructor — after primitive managers, before things that depend on it
this.#myManager = new MyManager({
  getGlyph: () => this.#$glyph.value,
  getSomething: () => this.#font.getSomething(),
});
```

Then add delegation methods on Editor:

```typescript
public doSomething(arg: Foo): Bar {
  return this.#myManager.doSomething(arg);
}
```

Delegation rules:

- One-liner methods — no logic in Editor, just forward
- Return types match the manager method exactly
- If adapting types (e.g. `Set` → `Array`), do the conversion inline: `[...ids]`

### 4. Export — `managers/index.ts`

Add a named export:

```typescript
export { MyManager } from "./MyManager";
```

Also export the dep interface if other code needs it (e.g. for testing):

```typescript
export { MyManager, type My } from "./MyManager";
```

### 5. EditorAPI / ShiftEditor — `lib/tools/core/EditorAPI.ts`

If tools need access to the manager's functionality, add methods to the appropriate EditorAPI sub-interface:

```typescript
// Add to an existing sub-interface if it fits
export interface Snapping {
  createDragSnapSession(config: DragSnapSessionConfig): DragSnapSession;
  createRotateSnapSession(): RotateSnapSession;
  setSnapIndicator(indicator: SnapIndicator | null): void;
}

// Or create a new sub-interface if it's a new domain
export interface MyDomain {
  doSomething(arg: Foo): Bar;
}
```

Then add the new sub-interface to the composite `EditorAPI` type:

```typescript
export type EditorAPI = Viewport &
  Selection &
  HitTesting &
  Snapping &
  Editing &
  Commands &
  ToolLifecycle &
  VisualState &
  MyDomain & {
    readonly font: Font;
    readonly glyph: Signal<Glyph | null>;
  };
```

Update `ShiftEditor` in `Editor.ts` if it also needs the interface (it extends `EditorAPI`).

Update `MockToolContext` in `testing/services.ts` to implement any new methods.

## Verification Checklist

```bash
pnpm typecheck && pnpm test && pnpm lint:check
```
