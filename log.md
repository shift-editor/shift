# Shift WebGL / Performance Log

## Scope

This log captures the main implementation and performance work completed while porting the WebGL SDF handle proof-of-concept into Shift and then profiling the editor against very large glyphs and dense CJK/text-run scenarios.

## Rendering / GPU Handles

- Integrated a dedicated WebGL handle layer into the editor canvas stack.
- Added `regl` and implemented [apps/desktop/src/renderer/src/lib/graphics/backends/ReglHandleContext.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/graphics/backends/ReglHandleContext.ts).
- Implemented instanced GPU point-handle rendering with one shared quad and per-instance attributes for:
  - position
  - size
  - shape
  - rotation
  - colors
  - overlay state
- Added SDF-based GPU shapes for:
  - corner
  - smooth
  - control
  - direction
  - first
  - last
- Wired GPU rendering through [apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts).
- Kept Canvas2D fallback when GPU handles are unavailable or disabled.
- Added a debug toggle in the debug panel to enable/disable GPU handles for comparison.

## GPU Handle Correctness Fixes

- Fixed WebGL fragment shader compilation by enabling derivatives support.
- Corrected first/last handle rotation mapping from glyph space to screen space.
- Adjusted triangle/start-point geometry and non-circular stroke rendering.
- Tuned stroke thickness so corner/triangle outlines match the Canvas2D appearance more closely.
- Preserved hover/selected handle size changes on the GPU by encoding state into per-instance style data.

## GPU Handle Performance Work

- Replaced JS object-heavy GPU instance creation with packed `Float32Array` output.
- Reused the packed instance buffer across frames to reduce GC.
- Precomputed style payloads and numeric shape ids instead of recomputing them per frame.
- Added viewport culling before packing/uploading GPU handle instances.
- Simplified visibility checks to use one precomputed visible-scene rect.
- Removed string-to-shape conversions from the hot path.

## Canvas / Static Rendering Performance Work

- Cached contour `Path2D`s in [apps/desktop/src/renderer/src/lib/editor/rendering/render.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/render.ts).
- Cached contour bounds alongside cached paths.
- Switched outline rendering to `strokePath(...)` using cached contour paths.
- Added whole-contour culling for outline and fill passes.
- Switched filled preview rendering to cached contour `Path2D`s combined into one fill path instead of retracing contours every frame.
- Batched control-line rendering into fewer Canvas2D operations.
- Culled control lines to visible scene bounds.
- Reduced segment-highlight work from full-glyph scans to highlighted-segment-only rendering.
- Skipped unnecessary hover recomputation during viewport-only wheel pan.

## Text Run Rendering Performance Work

- Added viewport culling for text-run slots.
- Switched live-glyph text-run rendering to cached glyph-level `Path2D` reuse instead of rebuilding outlines each frame.
- Preserved duplicate live-glyph updates while avoiding contour retracing.
- Reduced text-run pan/zoom cost substantially by making rendering proportional to visible slots.

## Selection / Bounds / Sidebar Performance Work

- Replaced repeated `getPointById()` scans in selection bounding-rect computation with one-pass accumulation and caching.
- Cached segment-aware selection bounds by glyph and selection set.
- Added sidebar-only fast signals for:
  - glyph metrics
  - selection bounds
- During drag, sidebar LSB/RSB updates are derived from the live drag delta instead of recomputing from glyph geometry.
- Updated transform and scale sidebar sections to read the cheap sidebar selection-bounds signal instead of pulling full segment-aware bounds from the live glyph every frame.

## Drag / Transform / Undo Performance Work

- Added [apps/desktop/src/renderer/src/lib/commands/primitives/SetNodePositionsCommand.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/commands/primitives/SetNodePositionsCommand.ts) for batched move-only edits.
- Replaced many move-heavy paths with batched absolute-position updates:
  - align
  - distribute
  - rotate
  - scale
  - reflect
  - several bezier update flows
- Changed point dragging to preview in JS during drag and commit once on pointer-up.
- Switched rotate/resize drag-end to commit previewed node positions directly instead of replaying the transform through a second full command path.
- Optimized move-only undo payload creation by constructing it from known updates rather than full glyph diff scans.

## Native Commit / Bridge Performance Work

- Replaced expensive move commit paths with lighter native move paths where possible.
- Added compact bridge methods so translate commits send flat ids and deltas instead of large object arrays.
- Added prepared native move support:
  - prepare selected ids once at drag start
  - send only `dx/dy` on pointer-up for uniform translation
- Optimized native `shift-core` edit-session point movement and set-node-position application to avoid repeated contour lookups and instead mutate through one-pass contour scans.

## Rules Engine Performance Work

- Built point indexes once per drag solve.
- Added conservative fast paths that skip rule resolution for plain corner-only translations.
- Added prepared drag-rule state so point indexes and rule sensitivity are computed once at drag start.
- Added a lightweight matcher path for drag use that avoids diagnostics-style probe allocation.
- Moved normal editor drag paths to omit matched-rule metadata unless explicitly requested.
- Moved more drag-time logic to precomputed state instead of per-frame recomputation.

## Remaining / Recent Hotspots

At the current point in profiling, the largest remaining recurring hotspots are:

- GPU handle packing when fully zoomed out with very dense selections
- `previewNodePositions(...)` / signal churn during extremely large drag previews
- any remaining drag-adjacent UI recomputation that depends on full-glyph state rather than cached drag deltas

Likely next steps if more performance is needed:

- reduce or degrade GPU handle work during active drag at extreme densities
- add a navigation-only glyph or text-run bitmap cache keyed by zoom bucket
- patch preview updates even more aggressively to avoid unnecessary object churn

## Cleanup / Review Areas

These are the highest-value areas for a dedicated cleanup pass or a second agent review.

### 1. Editor Drag Architecture

Files:

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)
- [apps/desktop/src/renderer/src/lib/tools/select/behaviors/TranslateBehavior.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/select/behaviors/TranslateBehavior.ts)
- [apps/desktop/src/renderer/src/lib/tools/select/behaviors/ResizeBehavior.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/select/behaviors/ResizeBehavior.ts)
- [apps/desktop/src/renderer/src/lib/tools/select/behaviors/RotateBehavior.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/select/behaviors/RotateBehavior.ts)

Check for:

- duplicated preview / commit / cancel logic across translate, rotate, and resize
- drag-specific state that should live in one reusable session object instead of `Editor` plus tool behaviors
- places where translate-only shortcuts can be generalized into a shared transform-preview abstraction

### 2. Preview Mutation Pipeline

Files:

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)
- [apps/desktop/src/renderer/src/engine/editing.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/engine/editing.ts)

Check for:

- overlap between `previewNodePositions`, `commitPreviewNodePositions`, `syncNodePositions`, and move commit helpers
- whether preview patching and native sync can share more code paths or data structures
- whether drag delta handling, sidebar overrides, and deferred text-run refresh belong in a cleaner preview-session model

### 3. GPU Handle Pipeline Shape

Files:

- [apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts)
- [apps/desktop/src/renderer/src/lib/graphics/backends/ReglHandleContext.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/graphics/backends/ReglHandleContext.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts)

Check for:

- duplicate viewport math between `CanvasCoordinator` and GPU handle packing
- whether handle packing should move closer to `ReglHandleContext`
- whether we want a deliberate quality/perf mode during dense drags instead of always rendering the full handle set
- opportunities to remove remaining per-frame branching or redundant style lookups

### 4. Cached Path / Render Cache Consolidation

Files:

- [apps/desktop/src/renderer/src/lib/editor/rendering/render.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/render.ts)
- [apps/desktop/src/renderer/src/lib/cache/GlyphRenderCache.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/cache/GlyphRenderCache.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/passes/glyph.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/passes/glyph.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/passes/textRun.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/passes/textRun.ts)

Check for:

- parallel path-cache systems that could be unified
- whether contour-level and glyph-level `Path2D` caching should share one cache API
- invalidation boundaries and ownership of cached geometry

### 5. Rules Engine Boundary

Files:

- [packages/rules/src/actions.ts](/Users/kostyafarber/repos/shift/packages/rules/src/actions.ts)
- [packages/rules/src/matcher.ts](/Users/kostyafarber/repos/shift/packages/rules/src/matcher.ts)
- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Check for:

- whether drag-only prepared state should be a first-class API rather than layered onto the existing API
- whether diagnostics, matching, and application should be split more cleanly
- whether the editor should know less about prepared rule state internals

### 6. Native Editing API Shape

Files:

- [apps/desktop/src/shared/bridge/FontEngineAPI.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/shared/bridge/FontEngineAPI.ts)
- [apps/desktop/src/renderer/src/engine/editing.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/engine/editing.ts)
- [crates/shift-node/src/font_engine.rs](/Users/kostyafarber/repos/shift/crates/shift-node/src/font_engine.rs)
- [crates/shift-core/src/edit_session.rs](/Users/kostyafarber/repos/shift/crates/shift-core/src/edit_session.rs)

Check for:

- duplication between full command-style bridge methods and the newer light/prepared move methods
- whether transform commits should converge on a clearer prepared-transform API
- whether current native APIs are too specialized around translate and should become affine-transform oriented

### 7. Sidebar / Derived State Separation

Files:

- [apps/desktop/src/renderer/src/components/sidebar-right/GlyphSection.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/GlyphSection.tsx)
- [apps/desktop/src/renderer/src/components/sidebar-right/ScaleSection.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/ScaleSection.tsx)
- [apps/desktop/src/renderer/src/components/sidebar-right/TransformSection.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/TransformSection.tsx)
- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

Check for:

- whether sidebar-only derived state should be collected into one small view-model layer
- whether the current override signals are the right abstraction or just a pragmatic patch
- whether more UI should subscribe to frozen/cheap editor state during drag

## Cleanup Checklist

Use this as the recommended handoff order for a second pass.

### High Payoff / Low-Medium Risk

- Unify drag preview lifecycle across translate, rotate, and resize.
  - Goal: one shared preview/commit/cancel abstraction instead of parallel behavior-specific implementations.
  - Main files:
    - [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)
    - [apps/desktop/src/renderer/src/lib/tools/select/behaviors/TranslateBehavior.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/select/behaviors/TranslateBehavior.ts)
    - [apps/desktop/src/renderer/src/lib/tools/select/behaviors/ResizeBehavior.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/select/behaviors/ResizeBehavior.ts)
    - [apps/desktop/src/renderer/src/lib/tools/select/behaviors/RotateBehavior.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/select/behaviors/RotateBehavior.ts)

- Consolidate preview-node update code paths.
  - Goal: reduce duplication between preview patching, commit helpers, and native sync helpers.
  - Main files:
    - [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)
    - [apps/desktop/src/renderer/src/engine/editing.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/engine/editing.ts)

- Consolidate cached geometry/path systems.
  - Goal: one coherent cache story for contour paths, glyph paths, and text-run path reuse.
  - Main files:
    - [apps/desktop/src/renderer/src/lib/editor/rendering/render.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/render.ts)
    - [apps/desktop/src/renderer/src/lib/cache/GlyphRenderCache.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/cache/GlyphRenderCache.ts)
    - [apps/desktop/src/renderer/src/lib/editor/rendering/passes/glyph.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/passes/glyph.ts)
    - [apps/desktop/src/renderer/src/lib/editor/rendering/passes/textRun.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/passes/textRun.ts)

### High Payoff / Higher Risk

- Rework GPU handle packing ownership.
  - Goal: reduce duplicate viewport math and clarify whether packing belongs in renderer coordination or the WebGL backend.
  - Main files:
    - [apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/gpu/handleInstances.ts)

## Refactor Port Handoff

### Latest Checkpoints

- `9da55eb` — `Checkpoint refactor parity port`
- `f559300` — `Refine editor parity and rendering test scaffolding`

### What Landed In This Phase

- Ported a large chunk of `kostya/pen-tool-etc-refactir` into the active desktop/editor/tool stack without keeping backwards-compat hooks.
- Kept the current branch perf work integrated where it still fits the refactor shape, especially around:
  - GPU handle rendering
  - cached contour/glyph/text-run path rendering
  - drag preview / native transform support
- Moved editor/tool behavior further onto the refactored model:
  - removed legacy pen/select action-model files
  - added node-position preview / drag support
  - restored command-history paths for editor operations where I had drifted from branch behavior
- Fixed renderer-test infrastructure so cached `Path2D` rendering works in Vitest.
- Brought the test/mock viewport API into line with the scalar coordinate projection shape used by the current editor/viewport code.

### Important Files Touched

- [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)
- [apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts)
- [apps/desktop/src/renderer/src/lib/tools/core/EditorAPI.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/core/EditorAPI.ts)
- [apps/desktop/src/renderer/src/lib/editor/SidebarViewModel.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/SidebarViewModel.ts)
- [apps/desktop/src/renderer/src/lib/editor/PreparedNodeTransformSession.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/PreparedNodeTransformSession.ts)
- [apps/desktop/src/renderer/src/lib/editor/PointDragConstraintSession.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/PointDragConstraintSession.ts)
- [apps/desktop/src/renderer/src/testing/setup.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/setup.ts)
- [apps/desktop/src/renderer/src/testing/services.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services.ts)

### Current Health Snapshot

- `pnpm -C apps/desktop exec tsc --noEmit --pretty false` passes.
- Targeted editor/render/tool suites pass, including:
  - `ViewportManager.test.ts`
  - `glyph.test.ts`
  - `textRun.test.ts`
  - `Select.test.ts`
  - `Text.test.ts`
  - command history / point command slices
- `pre-commit run --all-files` is mostly green until:
  - `deadcode (strict)`
  - `vitest` because of `Pen.test.ts`

### Known Remaining Non-Pen Issues

- `deadcode (strict)` still reports:
  - unused files:
    - [apps/desktop/src/renderer/src/components/sidebar-right/Sidebar.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/Sidebar.tsx)
    - [apps/desktop/src/renderer/src/lib/tools/pen/operations.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/tools/pen/operations.ts)
    - [apps/desktop/src/renderer/src/testing/services-internal/factories.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services-internal/factories.ts)
    - [apps/desktop/src/renderer/src/testing/services-internal/types.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/testing/services-internal/types.ts)
    - [apps/desktop/src/renderer/src/types/textContext.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/types/textContext.ts)
  - unused exports:
    - `createRotationTransform`
    - `createScaleTransform`
    - in [apps/desktop/src/renderer/src/lib/editor/affineTransform.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/affineTransform.ts)

### Pen Status

- `Pen.test.ts` is still the only behavioral test failure in the full desktop suite.
- That surface was intentionally left unfinished because pen is being refactored manually.
- Non-pen work should avoid trying to “fix around” pen behavior until that refactor lands.

### Recommended Resume Order After Pen Refactor

1. Re-run `pre-commit run --all-files`.
2. Reconcile the new pen refactor with the current editor/tool API surface.
3. Clear the remaining `deadcode` findings.
4. Continue shrinking the remaining diff in [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts), focusing on drag/preview/selection internals rather than renderer architecture.
   - [apps/desktop/src/renderer/src/lib/graphics/backends/ReglHandleContext.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/graphics/backends/ReglHandleContext.ts)
   - [apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/rendering/CanvasCoordinator.ts)

- Generalize the native editing API around prepared transforms rather than translate-specific helpers.
  - Goal: shape the bridge for future rotate/resize/affine commits and reduce one-off methods.
  - Main files:
    - [apps/desktop/src/shared/bridge/FontEngineAPI.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/shared/bridge/FontEngineAPI.ts)
    - [apps/desktop/src/renderer/src/engine/editing.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/engine/editing.ts)
    - [crates/shift-node/src/font_engine.rs](/Users/kostyafarber/repos/shift/crates/shift-node/src/font_engine.rs)
    - [crates/shift-core/src/edit_session.rs](/Users/kostyafarber/repos/shift/crates/shift-core/src/edit_session.rs)

### Medium Payoff / Low Risk

- Tighten rules-engine layering.
  - Goal: separate diagnostics, matching, prepared drag state, and rule application more cleanly.
  - Main files:
    - [packages/rules/src/actions.ts](/Users/kostyafarber/repos/shift/packages/rules/src/actions.ts)
    - [packages/rules/src/matcher.ts](/Users/kostyafarber/repos/shift/packages/rules/src/matcher.ts)
    - [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

- Move sidebar-specific derived state into a clearer view-model layer.
  - Goal: avoid `Editor` absorbing more UI-specific override signals over time.
  - Main files:
    - [apps/desktop/src/renderer/src/components/sidebar-right/GlyphSection.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/GlyphSection.tsx)
    - [apps/desktop/src/renderer/src/components/sidebar-right/ScaleSection.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/ScaleSection.tsx)
    - [apps/desktop/src/renderer/src/components/sidebar-right/TransformSection.tsx](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/components/sidebar-right/TransformSection.tsx)
    - [apps/desktop/src/renderer/src/lib/editor/Editor.ts](/Users/kostyafarber/repos/shift/apps/desktop/src/renderer/src/lib/editor/Editor.ts)

### Suggested Review Order

1. Drag preview lifecycle unification
2. Preview-node update consolidation
3. Cached path/render cache consolidation
4. GPU handle packing ownership
5. Native prepared-transform API shape
6. Rules-engine boundary cleanup
7. Sidebar view-model separation

## Debug / Instrumentation Added

- Added a one-shot console log for total glyph point count:
  - `[CanvasCoordinator] Total glyph points: <count>`
- Added GPU-handles enable/disable comparison toggle in the debug panel.

## Validation Performed

Across this work, the following validations were run repeatedly as edits landed:

- `pnpm test:typecheck`
- focused desktop renderer/editor tests
- `pnpm --filter @shift/rules test`
- `cargo check -p shift-node`
- focused `shift-core` / `shift-node` tests for native drag paths

## Notes

- Public debug diagnostics for rule matching are not on the normal drag hot path.
- Most recent drag-path work now uses prepared state and avoids diagnostics in normal operation.
- The current worktree contains both staged and unstaged changes related to this effort.
