# shift-font

First-class Rust font object model for Shift.

## Object Model

- `Font` owns glyphs, sources, axes, axis mappings, metadata, and font-level data.
- `Axis` has stable identity, an external/internal role, a continuous or discrete kind, and optional user-space value labels.
- `AxisMapping` owns an ordered set of mapping points. Independent mappings transform one external axis; the optional cross-axis group maps one design-space location to another.
- `Source` is an editable designspace position with a name and location.
- `Glyph` is a glyph concept identified by `GlyphId`.
- `GlyphLayer` is authored editable data for one glyph at one source.
- `Contour` and `Point` describe outline geometry inside a glyph layer.

## Identity

Stable IDs are identity. Names and Unicode values are editable metadata.

- `GlyphId` identifies a glyph.
- `SourceId` identifies a source.
- `LayerId` identifies a glyph layer: the authored data for one glyph at one source.
- `AxisMappingId` identifies a font-owned mapping independently of its editable name.

## Responsibilities

- Own font authoring data structures such as `Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, `Source`, and `Axis`.
- Keep object-level mutation behavior near the objects it mutates.
- Provide model-native helpers for layer editing, component resolution, variation behavior, axis mapping evaluation, and geometry-derived behavior.
- Stay independent of TypeScript, NAPI, and bridge DTOs.

## Boundaries

`shift-font` should not expose TypeScript-facing wire contracts. Those belong in `shift-wire`.

`shift-font` should not perform SQLite persistence. Durable working-store reads and writes belong in `shift-store`.

`shift-font` should not own Electron, NAPI, or editor state. The TypeScript editor owns UI interaction, selection, hover, camera, tools, and command history.

## Editing Shape

Mutations should live on the model object being mutated:

```rust
layer.add_empty_contour();
layer.add_point_to_contour(contour_id, x, y, point_type, smooth)?;
layer.remove_points(&point_ids)?;
layer.apply_bulk_node_positions(updates)?;
```

Transport and workspace layers should pass stable identity to find the model object, then call these methods. They should not introduce hidden native edit sessions.
