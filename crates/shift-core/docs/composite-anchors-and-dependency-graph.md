# Anchor Offset and Dependency Graphs

This document explains how composite glyph placement and dependent-glyph tracking
work across the Rust crates.

## Scope

- Anchor/offset resolution for composite components
- Flattening composite contours for rendering
- Dependency graph traversal for affected glyph queries

## Crate Responsibilities

- `shift-core`: owns composite resolution and dependency graph algorithms
- `shift-node`: provides session-aware layer lookup and exposes N-API methods
- `shift-ir`: provides data model and transform primitives used by the resolver

## Anchor and Offset Resolution

Implementation lives in `crates/shift-core/src/composite.rs`.

### Terminology

- **Explicit transform**: component matrix stored on the component (`Transform`)
- **Primary attachment anchor**: component anchor named `_{name}`
- **Base anchor**: previously placed anchor named `{name}`

### Resolution Precedence

For each component, transform resolution is:

1. Start with the explicit component matrix.
2. Try primary anchor attachment:
   - Find component anchor named `_{name}`.
   - Attach it to the most recently placed base anchor named `{name}`.
3. If no primary attachment matches, keep the explicit component transform.

The final transform is `compose_transform(offset, explicit_transform)` where
`offset` is a translation derived from anchor rules.

### Placement Order and Determinism

- Components are processed in stable ID order (`ComponentId::raw`).
- Resolved component anchors are appended in traversal order.
- Anchor lookup prefers the most recently appended matching anchor.

### Cycle Handling

Recursive flattening tracks a per-branch `visiting` set.
If a glyph is re-entered on the same branch, that branch is skipped.
Non-cyclic branches still resolve normally.

## Composite Flattening Output

- `flatten_component_contours_for_layer` returns only resolved component contours
  (root contours are not included in the returned vector).
- Callers that need full geometry combine root contours + resolved component
  contours.
- Helpers:
  - `resolved_to_render_contours`: conversion to snapshot render contours
  - `layer_to_svg_path`: root + component contours -> SVG `d`
  - `layer_bbox`: tight bounds over root + component contours

## Dependency Graph

Implementation lives in `crates/shift-core/src/dependency_graph.rs`.

### Graph Directions

- `uses`: `A -> B` means glyph `A` includes `B` as a component.
- `used_by`: reverse index for finding dependents.

### Build and Query

- `DependencyGraph::rebuild` scans all glyph layers in the font.
- `dependents_recursive(glyph)` returns all transitive dependents of `glyph`.
- Root glyph is excluded from results, even when cycles exist.

## Node Integration

`crates/shift-node/src/font_engine.rs` uses `EngineLayerProvider` to make
composite resolution session-aware:

- If the queried glyph is currently being edited, use the in-session layer.
- Otherwise, resolve from persisted font data via preferred layer selection.

Relevant methods:

- `get_glyph_svg_path`: includes flattened component contours
- `get_glyph_bbox`: includes flattened component contours
- `get_snapshot_data` / command result enrichment: includes
  `composite_contours`
- `get_dependent_unicodes`: uses dependency graph transitive traversal

## Edge Cases and Current Behavior

- Missing component glyph/layer: component branch contributes nothing.
- Missing attachment anchors: explicit transform is used unchanged.

These rules are intentionally documented as current behavior so refactors can
preserve semantics unless a behavior change is explicitly planned.
