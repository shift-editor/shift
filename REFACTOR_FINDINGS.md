# Refactor Findings

Current review findings for the desktop editor/rendering refactor. These are meant to be worked through manually during cleanup, not treated as a strict implementation plan.

## High

### 1. `Editor.ts` has two overlapping preview systems

Files:

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Issue:

- The old snapshot preview lifecycle still exists through `beginPreview()`, `cancelPreview()`, and `commitPreview()`.
- A second node-position preview/session lifecycle now exists through `beginInteractionSession()`, `beginNodePositionPreview()`, and `#createNodePositionPreviewSession(...)`.
- Drag commit paths also feed through that newer session model.
- This leaves the editor with two different “preview” abstractions and no single canonical owner.

Why it matters:

- Tools can reach preview behavior through different conceptual paths.
- It is hard to know which preview mechanism is the intended one for new work.
- Cleanup/refactors in one preview path can easily miss the other.

### 2. Drag lifecycle ownership is split across too many layers

Files:

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)
- [apps/desktop/src/renderer/src/lib/editor/PreparedNodeTransformSession.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/PreparedNodeTransformSession.ts)
- [apps/desktop/src/renderer/src/lib/editor/PointDragConstraintSession.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/PointDragConstraintSession.ts)

Issue:

- `beginDrag(...)` creates a drag context, but the actual drag behavior is split between:
  - preview session callbacks
  - `#updateDrag(...)`
  - `#getSimpleDragCommitDelta(...)`
  - `commitToNative`
  - `#commitNodePositionPreview(...)`
  - prepared native transform session helpers
- The drag abstraction is present, but the commit/cancel behavior is still distributed.

Why it matters:

- Uniform translation, constrained drags, and preview restore logic are harder to audit.
- It is easy to break drag commit semantics while touching preview code or vice versa.

### 3. CPU and GPU handle rendering still duplicate handle classification logic

Files:

- [apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/passes/handles.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/passes/handles.ts)

Issue:

- Traversal style is now closer, but the actual handle classification rules still exist in two places:
  - GPU: `classifyHandlePoint(...)`
  - CPU: inline logic in `renderHandles(...)`
- First/last/direction/smooth/control behavior can drift again.

Why it matters:

- Rendering correctness depends on two implementations staying in sync.
- Any future tweak to handle semantics has to be duplicated manually.

### 4. `EditorAPI` no longer matches the effective editor/viewport contract

Files:

- [apps/desktop/src/renderer/src/lib/tools/core/EditorAPI.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/EditorAPI.ts)
- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Issue:

- `Editor.ts` supports scalar overloads for several viewport helpers.
- `EditorAPI` still advertises older point-object signatures for some of the same concepts.
- The interface is no longer the clean source of truth for the concrete editor shape.

Why it matters:

- The type layer hides drift instead of preventing it.
- Mock/test/editor implementations can silently diverge.

## Medium

### 5. `Editor.ts` mixes command orchestration, query caching, and view-model derivation

Files:

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Issue:

- The class owns:
  - viewport helpers
  - command orchestration
  - geometry queries
  - drag lifecycle
  - preview lifecycle
  - sidebar transient state
  - query caches
  - render-facing context
- None of these areas are clearly separated.

Why it matters:

- The file is hard to review safely.
- Cleanup in one area tends to require reloading unrelated editor concerns.

### 6. Local cache/index builders in `Editor.ts` should probably move together

Files:

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Issue:

- The editor currently owns several hand-managed caches:
  - selection bounding rect
  - segment-aware selection bounds
  - segment lookup index
  - point location map
- All of them use similar “cache by glyph and selection/reference identity” patterns.

Why it matters:

- This is duplicated cache policy with no clear shared owner.
- Subtle invalidation bugs become more likely as more caches are added.

### 7. `CanvasCoordinatorContext` is getting too implementation-specific

Files:

- [apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts)

Issue:

- The context interface now exposes a fairly wide surface:
  - selected segment ids
  - segment lookup
  - GPU handle enablement
  - tool contributor layers
  - draw offset
  - viewport transform
  - handle states
- This is practical, but it means the renderer is pulling more editor internals directly.

Why it matters:

- It becomes harder to tell what is actual renderer state vs editor implementation leakage.
- Alternative renderer wiring or future decomposition gets more expensive.

### 8. Test scaffolding is duplicated across two parallel helper stacks

Files:

- [apps/desktop/src/renderer/src/testing/services.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services.ts)
- [apps/desktop/src/renderer/src/testing/services-internal/factories.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services-internal/factories.ts)
- [apps/desktop/src/renderer/src/testing/services-internal/types.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services-internal/types.ts)

Issue:

- There are two different mock/support layers covering similar editor/tool-test concepts.
- `deadcode` is already flagging the internal layer as unused.

Why it matters:

- The repo is paying maintenance cost for unused test abstractions.
- API-shape fixes need to be mirrored in multiple places or they go stale.

### 9. `SidebarViewModel` is a good direction but still feels like a narrow patch

Files:

- [apps/desktop/src/renderer/src/lib/editor/SidebarViewModel.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/SidebarViewModel.ts)
- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Issue:

- The sidebar model currently handles:
  - frozen glyph
  - glyph info override
  - selection bounds override
- The abstraction is useful, but it is tightly shaped around the current drag-preview workaround rather than a broader derived-state model.

Why it matters:

- It may accumulate more ad hoc “override” knobs instead of becoming a deliberate editor view model.

### 10. Tool override lifecycle in `ToolManager` is asymmetric

Files:

- [apps/desktop/src/renderer/src/lib/tools/core/ToolManager.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/ToolManager.ts)

Issue:

- `requestTemporary(...)` activates the override tool without deactivating the primary tool.
- `returnFromTemporary()` drops the override and restores state without re-activating the primary tool.
- `releaseOverride()` does re-activate the primary tool.
- That means the two code paths for leaving a temporary tool do not have the same lifecycle semantics.

Why it matters:

- Tools with meaningful `activate()` / `deactivate()` side effects can behave inconsistently depending on which override-exit path ran.
- This makes temporary-tool behavior harder to reason about and easier to regress.

### 11. Command batch semantics and documentation are inconsistent

Files:

- [apps/desktop/src/renderer/src/lib/commands/core/CommandHistory.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/core/CommandHistory.ts)
- [apps/desktop/src/renderer/src/lib/tools/core/BaseTool.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/BaseTool.ts)

Issue:

- `CommandHistory.cancelBatch()` explicitly does not roll back already-executed commands.
- `CommandHistory.withBatch(...)` also just cancels the batch on exception.
- But `BaseTool.batch(...)` claims it “Automatically rolls back on exception.”

Why it matters:

- This is a real contract/documentation mismatch.
- Callers may believe a failed batch is atomic when it is not.
- Refactors around tool-side batching can accidentally depend on rollback behavior that does not exist.

### 12. `BaseTool` fires state-enter/state-exit hooks for every behavior on every transition

Files:

- [apps/desktop/src/renderer/src/lib/tools/core/BaseTool.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/BaseTool.ts)
- [apps/desktop/src/renderer/src/lib/tools/core/Behavior.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/Behavior.ts)

Issue:

- After any state transition, `BaseTool.handleEvent(...)` loops over all behaviors and calls:
  - every `onStateExit`
  - every `onStateEnter`
- This is independent of which behavior actually handled the triggering event.

Why it matters:

- It creates a very broad side-effect model for behavior hooks.
- Behavior objects are less isolated than they appear from the event-handler model.
- It becomes easier for tools to accumulate implicit cross-behavior coupling.

### 13. Pointer/hover/update ownership is split between DOM, `ToolManager`, and editor viewport state

Files:

- [apps/desktop/src/renderer/src/lib/tools/core/ToolManager.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/ToolManager.ts)
- [apps/desktop/src/renderer/src/lib/tools/core/GestureDetector.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/GestureDetector.ts)
- [apps/desktop/src/renderer/src/lib/editor/managers/ViewportManager.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/managers/ViewportManager.ts)

Issue:

- Pointer movement is buffered/coalesced in `ToolManager`.
- Mouse position is separately buffered/flushed in `ViewportManager`.
- Gesture semantics are computed in `GestureDetector`.
- Hover application is conditionally applied back in `ToolManager`.

Why it matters:

- This works, but the update path is distributed across three layers.
- It is difficult to reason about where “current pointer truth” actually lives during drag/hover refactors.
- Timing-sensitive behavior can regress when changing any one layer in isolation.

### 17. Internal docs are stale and still describe pre-refactor tool and command contracts

Files:

- [apps/desktop/src/renderer/src/lib/tools/docs/CONTEXT.md](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/docs/CONTEXT.md)
- [apps/desktop/src/renderer/src/lib/commands/docs/CONTEXT.md](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/docs/CONTEXT.md)

Issue:

- The tool docs still describe an older `BaseTool<S, A, Settings>` action model with:
  - `executeAction(...)`
  - `beginPreview()`
  - `commitPreview()`
  - `cancelPreview()`
- The command docs still show older context naming and a simplified `CommandHistory` shape that does not cover:
  - batching
  - `record(...)`
  - the real `glyph` field name on `CommandContext`

Why it matters:

- These docs are now actively misleading for human refactor work.
- They preserve old mental models even after the code moved on.
- If you want the codebase to feel coherent, the docs need to stop describing deleted architecture.

### 18. Renderer hot paths still do extra per-frame work that could be centralized

Files:

- [apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts)

Issue:

- `CanvasCoordinator.#drawStatic()` repeatedly recomputes the same frame-gating policy inline:
  - editable glyph visibility
  - preview-vs-outline policy
  - selected-segment materialization
  - debug overlay gating
- `buildPackedGpuHandleInstances(...)` also walks all glyph points once to count instances, then walks them again to actually classify and pack visible handles.

Why it matters:

- This is not a correctness bug, but it keeps hot-path render policy scattered.
- The draw loop is paying extra work and carrying extra branching in exactly the part of the codebase you care about keeping sharp.
- A small per-frame derived render-state object would make the coordinator easier to reason about and would reduce repeated logic.

### 19. Selection state logic is triplicated instead of owned by one reusable selection-set helper

Files:

- [apps/desktop/src/renderer/src/lib/editor/managers/SelectionManager.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/managers/SelectionManager.ts)

Issue:

- Point, anchor, and segment selection all implement the same operations separately:
  - select
  - add
  - remove
  - toggle
  - isSelected
- The three branches are almost the same code, but they still differ slightly in API shape, for example `selectSegments(...)` taking a `ReadonlySet` while the other bulk setters take arrays.

Why it matters:

- This is straightforward duplication in a core state manager.
- Small behavior changes to selection semantics have to be mirrored three times.
- API inconsistencies accumulate when there is no single owner for “selection set” mechanics.

### 20. Drag optimization support is split across thin session wrappers with no shared contract

Files:

- [apps/desktop/src/renderer/src/lib/editor/PreparedNodeTransformSession.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/PreparedNodeTransformSession.ts)
- [apps/desktop/src/renderer/src/lib/editor/PointDragConstraintSession.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/PointDragConstraintSession.ts)
- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Issue:

- These helpers are both valid, but each one is its own tiny lifecycle abstraction:
  - prepare
  - apply/constrain
  - sometimes dispose
- They do not share a common drag-session contract, so `Editor.ts` still has to understand how to coordinate them explicitly.

Why it matters:

- This keeps the drag/perf path feeling “assembled” rather than owned.
- The next round of transform/preview cleanup will still have to touch `Editor.ts` directly because the helper boundaries are inconsistent.
- A shared contract would make these helpers feel like parts of one pipeline instead of sidecar optimizations.

## Low

### 14. Overloaded point-or-xy helper style is spreading

Files:

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Issue:

- Many editor methods accept either a `Point2D` or `x, y` through local overloads and `resolvePointInput(...)`.
- This is convenient, but it expands the public/editor surface significantly.

Why it matters:

- Harder grepability.
- More interface drift between `Editor.ts`, `EditorAPI`, and test mocks.

### 15. Mock tool context still carries stale/non-canonical editor surface

Files:

- [apps/desktop/src/renderer/src/testing/services.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services.ts)

Issue:

- `MockToolContext` extends `EditorAPI`, but also carries extra methods like:
  - `getGlyphSvgPath`
  - `getGlyphAdvance`
  - `setTextContent`
  - `getTextContent`
  - `resumeTextEditing`
  - `switchEditSession`
- These look like leftovers from older text-editing/editor contracts rather than the canonical current interface.

Why it matters:

- Tests can keep old API shapes alive long after production code has moved on.
- This makes it harder to tell which editor methods are actually intended to remain public.

### 16. There are still deadcode leftovers that need a real decision

Files:

- [apps/desktop/src/renderer/src/components/sidebar-right/Sidebar.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/Sidebar.tsx)
- [apps/desktop/src/renderer/src/types/textContext.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/types/textContext.ts)
- [apps/desktop/src/renderer/src/lib/editor/affineTransform.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/affineTransform.ts)

Issue:

- `Sidebar.tsx` and `textContext.ts` appear to be leftover branch/refactor artifacts.
- `createRotationTransform` and `createScaleTransform` are exported but unused.

Why it matters:

- These are not urgent behavior problems, but they keep the codebase looking unfinished.
- They also make it harder to tell what is the intended architecture vs leftover migration debris.

### 21. `MockToolContext` is doing too much service aggregation for one test helper

Files:

- [apps/desktop/src/renderer/src/testing/services.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services.ts)

Issue:

- The test helper is not just an `EditorAPI` mock.
- It also exposes bundled sub-services for:
  - screen
  - selection
  - hover
  - edit
  - preview
  - transform
  - cursor
  - render
  - viewport
  - hit testing
- That makes it convenient, but it also makes one file the de facto owner of many interface slices at once.

Why it matters:

- Test helpers this broad become a second architecture diagram.
- They are prone to interface drift because production boundaries and mock boundaries evolve at different speeds.
- Refactors become heavier because every subsystem change wants to route through one oversized mock surface.

### 22. `SidebarViewModel` still encodes transient behavior as imperative overrides instead of named editor states

Files:

- [apps/desktop/src/renderer/src/lib/editor/SidebarViewModel.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/SidebarViewModel.ts)

Issue:

- The abstraction currently exposes imperative knobs:
  - `freezeGlyph(...)`
  - `overrideGlyphInfo(...)`
  - `overrideSelectionBounds(...)`
  - `clearTransientState()`
- That works, but it means the view model is still being pushed around by callers instead of deriving a clearer finite set of sidebar display states.

Why it matters:

- More override-style setters will make this model harder to reason about over time.
- If the sidebar keeps growing, this object risks becoming a bag of temporary patches rather than a durable derived-state boundary.

### 23. Tool render contributors get the full `EditorAPI` when they only need a tiny render-facing slice

Files:

- [apps/desktop/src/renderer/src/lib/tools/core/ToolRenderContributor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/ToolRenderContributor.ts)
- [apps/desktop/src/renderer/src/lib/tools/text/TextRunRenderContributor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/text/TextRunRenderContributor.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts)

Issue:

- `ToolRenderContext` exposes `editor: EditorAPI` directly to render contributors.
- In practice, contributors like `textRunRenderContributor` only need a narrow subset:
  - text run state
  - glyph metadata
  - font metrics
  - composite component lookup
- This means render-time code can freely reach into the whole editor surface.

Why it matters:

- Renderer extension points become tightly coupled to editor implementation details.
- It becomes harder to reason about what render contributors are allowed to depend on.
- Any future decomposition of editor vs rendering gets more expensive because contributors already depend on the full editor contract.

Suggested fix:

- Introduce a narrow `RenderEditorAPI` or layer-specific render dependency object.
- Keep `ToolRenderContext` focused on rendering concerns and the specific read-only editor data needed for that layer.
- Migrate contributors incrementally by replacing `editor: EditorAPI` with explicit read methods they actually use.

### 24. `TextRunManager` mixes persistence, editing session state, hover state, inspection state, and layout recomputation

Files:

- [apps/desktop/src/renderer/src/lib/editor/managers/TextRunManager.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/managers/TextRunManager.ts)
- [apps/desktop/src/renderer/src/lib/editor/managers/textRunPersistence.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/managers/textRunPersistence.ts)

Issue:

- One manager currently owns:
  - per-glyph run persistence
  - gap buffer mutation
  - editing slot state
  - hover state
  - composite inspection state
  - cursor visibility
  - layout recomputation
  - serialization / hydration wiring
- That is a lot of unrelated ownership for one state container.

Why it matters:

- Text-run changes become harder to make safely because interaction, persistence, and presentation are entangled.
- It is hard to test the pure layout/presentation side separately from the mutating buffer state.
- This manager is likely to keep growing as text tooling gets more capable.

Suggested fix:

- Split the responsibilities into at least two layers:
  - a persistent mutable run store
  - a derived presentation/layout layer
- Keep serialization/hydration utilities attached to the persistent store shape, not the presentation layer.
- Make the public manager expose a smaller API that orchestrates those layers instead of directly owning every field.

### 25. Render-path caching is fragmented across multiple unrelated owners

Files:

- [apps/desktop/src/renderer/src/lib/cache/GlyphRenderCache.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/cache/GlyphRenderCache.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/render.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/render.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/passes/textRun.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/passes/textRun.ts)

Issue:

- Cache ownership is split between:
  - `GlyphRenderCache` for SVG `Path2D`
  - `GlyphRenderCache` again for contour geometry
  - a local `liveGlyphPathCache` in `textRun.ts`
  - helper-level caching hidden behind `getCachedContourPath(...)`
- These are all valid caches, but the cache boundaries are not deliberate.

Why it matters:

- It is hard to answer “where should this render cache live?” consistently.
- Cache invalidation policy becomes implicit instead of designed.
- The same rendering domain concept is represented by several different cache entry points.

Suggested fix:

- Turn `GlyphRenderCache` into a clearer rendering-cache module with named cache families:
  - svg path cache
  - contour geometry cache
  - live glyph aggregate path cache
- Keep the public API at the cache layer, not split between cache class and random local `WeakMap`s.
- Rename the module if needed so it reflects that it owns rendering cache policy, not just one glyph-path map.

### 26. `renderGlyphFilled(...)` allocates and rebuilds a merged `Path2D` every frame

Files:

- [apps/desktop/src/renderer/src/lib/editor/rendering/passes/glyph.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/passes/glyph.ts)

Issue:

- The fill pass creates a new `Path2D()` on each call and re-adds every visible contour path into it.
- Outline rendering already reuses cached contour paths, but the fill pass still rebuilds the aggregate path every frame.

Why it matters:

- Preview-mode fill is in a render hot path.
- This adds allocation and per-frame contour iteration work that may be avoidable.
- It also means fill and outline paths have different reuse stories even though they are drawing the same glyph geometry.

Suggested fix:

- Either fill visible contour paths directly without building an aggregate path, or cache a merged fill path for the renderable contour set.
- If visibility culling requires per-contour logic, prefer keeping the loop but avoid the extra aggregate `Path2D` allocation.
- Keep the chosen strategy aligned with how text-run live glyph fill is cached so both passes share the same performance model.

### 27. Editor docs are stale enough to describe files and APIs that no longer exist

Files:

- [apps/desktop/src/renderer/src/lib/editor/docs/CONTEXT.md](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/docs/CONTEXT.md)
- [apps/desktop/src/renderer/src/lib/editor/docs/DOCS.md](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/docs/DOCS.md)

Issue:

- The docs still describe old architecture like:
  - `Scene.ts`
  - `Viewport.ts`
  - `projectScreenToUpm(...)`
  - older `SelectionManager` APIs like `select(id)` and `setHovered(id)`
- They are no longer describing the current manager/rendering/coordinator setup.

Why it matters:

- The docs are now a source of architectural confusion instead of context.
- They make human cleanup slower because they send you looking for abstractions that are already gone.
- This is the same problem as the stale tools/commands docs, but on the editor side.

Suggested fix:

- Decide whether these docs should be maintained or deleted.
- If kept, rewrite them around the current architecture:
  - `Editor.ts`
  - `ViewportManager`
  - `CanvasCoordinator`
  - render passes
  - manager boundaries
- If they are not actively maintained, removing them is better than preserving false context.

### 28. Move-only command types are proliferating around slightly different patch shapes

Files:

- [apps/desktop/src/renderer/src/lib/commands/primitives/SetNodePositionsCommand.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/SetNodePositionsCommand.ts)
- [apps/desktop/src/renderer/src/lib/commands/primitives/NodePositionPatchCommand.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/NodePositionPatchCommand.ts)
- [apps/desktop/src/renderer/src/lib/commands/primitives/PointCommands.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/PointCommands.ts)
- [apps/desktop/src/renderer/src/lib/commands/transform/TransformCommands.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/transform/TransformCommands.ts)

Issue:

- There are several overlapping command shapes for “move some nodes and support undo”:
  - `MovePointsCommand`
  - `NudgePointsCommand`
  - `SetNodePositionsCommand`
  - `NodePositionPatchCommand`
  - transform commands that internally replay point moves
- They exist for valid reasons, but the taxonomy is no longer very crisp.

Why it matters:

- It is harder to know which command family is the intended one for new editor work.
- Undo/redo mechanics for move-only edits are now spread across several representations.
- This creates duplication in exactly the part of the command layer that is performance-sensitive and frequently used.

Suggested fix:

- Define one canonical move/patch representation for node-position changes.
- Keep alternate entry points as factories or thin wrappers if you still need distinct labels or ergonomic constructors.
- Document when to use:
  - delta-based point-only moves
  - absolute node-position patches
  - transform-specific commands
    so new code does not invent a fifth variant.

### 29. Some command classes are distinct only for naming, not behavior

Files:

- [apps/desktop/src/renderer/src/lib/commands/primitives/PointCommands.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/PointCommands.ts)
- [apps/desktop/src/renderer/src/lib/commands/primitives/BezierCommands.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/BezierCommands.ts)

Issue:

- `MovePointsCommand` and `NudgePointsCommand` are behaviorally identical except for the command label.
- `AddPointCommand` and `InsertPointCommand` are not identical, but they repeat the same “store inserted id, undo via remove” pattern.

Why it matters:

- Small command classes are fine, but this is now starting to look like taxonomy-by-name instead of taxonomy-by-behavior.
- Repeated boilerplate makes the command layer harder to scan.
- Bug fixes to command mechanics often need to be repeated across near-identical classes.

Suggested fix:

- For label-only differences, prefer a shared implementation plus a configurable label.
- For insert/add variants, consider a tiny reusable base for “create point and undo by removing created id” if more of these appear.
- Keep separate classes only where the semantic distinction materially improves readability or callsite intent.

### 30. Transform commands only operate on point IDs, while the rest of the editor increasingly thinks in nodes

Files:

- [apps/desktop/src/renderer/src/lib/commands/transform/TransformCommands.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/transform/TransformCommands.ts)
- [apps/desktop/src/renderer/src/lib/commands/primitives/SetNodePositionsCommand.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/SetNodePositionsCommand.ts)
- [apps/desktop/src/renderer/src/lib/commands/primitives/NodePositionPatchCommand.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/NodePositionPatchCommand.ts)

Issue:

- The transform command family is still point-only.
- Other newer movement paths already operate on a broader node abstraction that includes anchors.
- That means transform ownership and node-mutation ownership are drifting apart.

Why it matters:

- The command layer is carrying two conceptual models for geometric edits:
  - transform selected points
  - patch arbitrary node positions
- As anchor-aware transforms or richer drag operations expand, that split will get more awkward.

Suggested fix:

- Decide whether transforms should stay point-only by design or move onto the same node abstraction as other position updates.
- If point-only is intentional, document that boundary clearly.
- If not, introduce a shared transform/patch pipeline so future geometry commands do not have to choose between two different conceptual models.

## Suggested Review Order

1. Normalize preview/drag ownership in `Editor.ts`.
2. Make `EditorAPI` match the real editor/viewport contract.
3. Unify handle classification between CPU and GPU rendering.
4. Normalize temporary-tool lifecycle and batching contracts in tool/core.
5. Narrow render contributor/editor boundaries before more renderer-specific code piles onto `EditorAPI`.
6. Split or simplify `TextRunManager` before text tooling grows further.
7. Clean up stale internal docs so they describe the current contracts, not deleted ones.
8. Rationalize move/patch/transform command families before more variants appear.
9. Delete or consolidate dead test scaffolding and deadcode leftovers.
10. Decide whether `SidebarViewModel` becomes a broader derived-state layer or stays narrow.
