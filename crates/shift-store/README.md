# shift-store

`shift-store` owns Shift's durable source database.

The crate provides the storage boundary between the rest of the Rust application and SQLite. Callers should use typed store APIs exposed by this crate instead of preparing SQL statements or opening database connections directly.

## Responsibilities

- open and configure the SQLite connection;
- create and update the database schema;
- expose typed Rust APIs for source-store reads and writes;
- keep raw SQL local to this crate;
- preserve stable internal IDs for source entities;
- separate canonical source data from derived/index data as the store grows.

## Design Goals

- incremental writes;
- durability and crash-safe recovery;
- stable IDs;
- performant reads and writes for large fonts;
- clear handling of CJK-scale glyph inventories;
- efficient queries for references to and from source entities;
- support for components, kerning, and feature-related source data;
- clear separation between canonical source data and derived/index data;
- import/export support through typed store APIs rather than ad hoc SQL access.

## Shape

```text
src/
  connection.rs  # opening and configuring SQLite
  error.rs       # store error type
  glyph.rs       # glyph persistence API
  schema.rs      # schema creation and versioning entry point
  store.rs       # ShiftStore connection owner
  types.rs       # storage-facing IDs and small value types
```

Tests live in `tests/store_test.rs` and should start as small persistence checks before broader integration tests are added.
