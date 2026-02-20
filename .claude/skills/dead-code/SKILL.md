# /dead-code — Find and Remove Dead Code

Use this skill to find unused files, exports, and class members in the codebase. It uses Knip as a candidate generator, then verifies each candidate through AST-level analysis and interface tracing before removing anything.

**NEVER use `knip --fix`** — it has previously deleted code that was actually in use, breaking the editor and tests.

## Phase 1: Discovery

Run Knip to generate candidates:

```bash
pnpm deadcode 2>&1        # unused files + exports
pnpm deadcode:class 2>&1  # unused class members
```

Parse the output into three categories:

- **Unused files** — files with zero imports
- **Unused exports** — exported symbols with no consumers
- **Unused class members** — class methods/properties reported as unused

## Phase 2: Verification

For each candidate, apply the appropriate checks below. Use `scripts/find-refs.ts` when reading code alone is insufficient.

### Verifying Unused Files

1. Grep for the filename (without extension) across the codebase
2. Check config references: `tsconfig.json`, `vite.*.config.ts`, `forge.config.ts`
3. Check if it's a test helper imported by test files (Knip may miss test-only imports)
4. Check if it's referenced in `package.json` scripts or CI workflows

### Verifying Unused Exports

1. Check if re-exported by a barrel file (`index.ts`) consumed by another package
2. Check if used in `extends`/`implements` clauses
3. Check if used only in test files (Knip sometimes misses test imports)
4. Run `npx tsx scripts/find-refs.ts <file> <symbol>` for compiler-level reference count

### Verifying Unused Class Members (Main Pain Point)

This is where most false positives occur. Knip cannot trace usage through interfaces, composite types, or dep interfaces.

**Check these patterns in order:**

1. **Interface contract** — Is the member defined on an interface the class implements? Check the known interface contracts below.
2. **Composite type** — Is the class consumed through a type intersection? e.g., `ShiftEditor = EditorAPI & CanvasCoordinatorContext` means all `EditorAPI` members on `Editor` are used.
3. **Dep interface** — Is the member part of a dependency injection interface? Classes implement dep interfaces that are consumed by managers.
4. **Base class** — Is the member defined on a base class (`BaseCommand`, `BaseTool`) and used by subclasses?
5. **Abstract member** — Is it an abstract method that subclasses must implement?
6. **Find References** — Run `npx tsx scripts/find-refs.ts <file> <memberName>` for compiler confirmation.

### Known Interface Contracts (Always False Positives)

Members that satisfy any of these interfaces are NOT dead code, even if Knip reports them:

**EditorAPI sub-interfaces** (`apps/desktop/src/renderer/src/lib/tools/core/EditorAPI.ts`):

- `Viewport`: `zoomLevel`, `panX`, `panY`, `screenToUpm`, `upmToScreen`, `screenToUpmDistance`, `viewportBounds`
- `Selection`: `selectedPointIds`, `selectedSegmentIds`, `selectPoints`, `selectSegments`, `clearSelection`, `marqueePreviewPointIds`, `setMarqueePreview`
- `HitTesting`: `hitTestPoint`, `hitTestSegment`, `hitTestContour`, `hitTestBoundingBox`, `hitTestContourEndpoint`, `hitTestHandle`
- `Snapping`: `createDragSnapSession`, `createRotateSnapSession`, `setSnapIndicator`
- `Editing`: `startEdit`, `commitEdit`, `cancelEdit`, `isEditing`
- `Commands`: `execute`
- `ToolLifecycle`: `activeTool`, `setActiveTool`, `activeToolSettings`
- `VisualState`: `hoveredPoint`, `setHoveredPoint`, `hoveredSegment`, `setHoveredSegment`, `cursor`, `setCursor`

**Font interface** (`apps/desktop/src/renderer/src/lib/editor/Font.ts`):

- `getMetrics`, `getMetadata`, `getSvgPath`, `getAdvance`, `getBbox`

**Command interface** (`apps/desktop/src/renderer/src/lib/commands/core/`):

- `execute`, `undo`, `redo`, `name`

**Behavior interface** (`apps/desktop/src/renderer/src/lib/tools/core/`):

- `canHandle`, `transition`, `onTransition`

**BaseTool abstract members**:

- `behaviors`, `render`, `executeAction`, `onStateChange`, `preTransition`

**Dep interfaces** (consumed by managers, implemented by `FontEngine` or `Editor`):

- `EditingEngineDeps` — `apps/desktop/src/renderer/src/engine/editing.ts`
- `SessionEngineDeps` — `apps/desktop/src/renderer/src/engine/session.ts`
- `InfoEngineDeps` — `apps/desktop/src/renderer/src/engine/info.ts`
- `IOEngineDeps` — `apps/desktop/src/renderer/src/engine/io.ts`
- `Snap` — `apps/desktop/src/renderer/src/managers/SnapManager.ts`
- `Clipboard` — `apps/desktop/src/renderer/src/managers/ClipboardManager.ts`
- `CanvasCoordinatorContext` — `apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts`

### Using the Find References Script

```bash
# Check if a symbol has any non-definition references
npx tsx scripts/find-refs.ts apps/desktop/src/renderer/src/lib/editor/Editor.ts undo

# Output shows: file, line, kind (definition vs reference)
# Zero non-definition references = confirmed dead
# >0 references = inspect them to confirm usage
```

## Phase 3: Action

### Categorize Results

Present a categorized report:

| Category           | Meaning                                          | Action                      |
| ------------------ | ------------------------------------------------ | --------------------------- |
| **Confirmed dead** | No references, not on any interface              | Remove with confirmation    |
| **Likely dead**    | Ambiguous — few references, possibly test-only   | Flag for human review       |
| **False positive** | Interface-mediated, dep interface, or base class | Tag with `@knipclassignore` |

### Removing Confirmed Dead Code

1. Remove the dead code manually (NEVER use `knip --fix`)
2. Run verification after each batch of removals:
   ```bash
   pnpm typecheck && pnpm test && pnpm lint:check
   ```
3. If tests fail, revert the removal and recategorize as "likely dead"

### Tagging False Positives

For confirmed false positive class members, add the `@knipclassignore` JSDoc tag:

```typescript
/** @knipclassignore */
undo(): void {
    // ...
}
```

After tagging, decrease the `--max-issues` threshold in `package.json`'s `deadcode:class` script:

```bash
# Current threshold
pnpm deadcode:class  # check current --max-issues value

# After tagging N false positives, reduce by N
# Edit package.json: --max-issues (current - N)

# Verify the new threshold holds
pnpm deadcode:class
```

The goal is to drive `--max-issues` toward 0, at which point CI catches any new dead code with zero tolerance.

## Safety Protocol

1. **NEVER** use `knip --fix` or `deadcode:fix`
2. **NEVER** remove code without verifying it's not used through interfaces
3. **ALWAYS** run `pnpm typecheck && pnpm test && pnpm lint:check` after removals
4. **ALWAYS** check interface contracts before declaring a class member dead
5. If in doubt, categorize as "likely dead" rather than "confirmed dead"
