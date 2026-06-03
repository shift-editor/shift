# shift-font

First-class Rust font object model for Shift.

## Responsibilities

- Own font authoring data structures such as `Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, `Source`, and `Axis`.
- Keep object-level mutation behavior near the objects it mutates.
- Provide model-native helpers for layer editing, composite resolution, interpolation support, and geometry-derived behavior.
- Stay independent of TypeScript, NAPI, and bridge DTOs.

## Boundaries

`shift-font` should not expose TypeScript-facing wire contracts. Those belong in `shift-wire`.

`shift-font` should not perform SQLite persistence. Durable working-store reads and writes belong in `shift-store`.

`shift-font` should not own Electron, renderer, or tool state. The TypeScript editor owns UI interaction, selection, hover, camera, tools, and command history.

## Editing Shape

Mutations should live on the model object being mutated:

```rust
layer.add_empty_contour();
layer.add_point_to_contour(contour_id, x, y, point_type, smooth)?;
layer.remove_points(&point_ids)?;
layer.apply_bulk_node_positions(updates)?;
```

Transport layers should pass enough identity to find the model object, then call these methods. They should not introduce hidden native edit sessions.
