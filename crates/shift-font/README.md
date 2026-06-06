# shift-font

`shift-font` owns Shift's live Rust font authoring model.

This crate defines the domain objects used by Rust code to represent and mutate authored font data. It does not own SQLite persistence, `.shift` package IO, NAPI transport, Electron state, or TypeScript editor interaction state.

## Object Model

- `Font` owns glyphs, sources, axes, metadata, and font-level data.
- `Source` is an editable designspace position with a name and location.
- `Glyph` is a glyph concept identified by `GlyphId`.
- `GlyphLayer` is authored editable data for one glyph at one source.
- `Contour` and `Point` describe outline geometry inside a glyph layer.

## Identity

Stable IDs are identity. Names and Unicode values are editable metadata.

- `GlyphId` identifies a glyph.
- `SourceId` identifies a source.
- `LayerId` identifies a glyph layer: the authored data for one glyph at one source.

## Responsibilities

- define font authoring data structures;
- keep local mutation behavior near the objects it mutates;
- define semantic change records for model changes;
- provide geometry, component, and variation helpers used by the Rust model.

## Boundaries

`shift-font` should not expose TypeScript-facing wire contracts. Those belong in `shift-wire`.

`shift-font` should not perform SQLite persistence. Durable working-store reads and writes belong in `shift-store` and are coordinated by `shift-workspace`.

`shift-font` should not own `.shift` package layout. Source package IO belongs in `shift-source`.

`shift-font` should not own Electron, NAPI, or editor state. The TypeScript editor owns UI interaction, selection, hover, camera, tools, and command history.
