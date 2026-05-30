# shift-document

`shift-document` owns the Rust-side workflow for an open Shift document.

A document coordinates the lower-level crates:

- `shift-store` for the SQLite working store;
- `shift-ir` for the live in-memory projection;
- `shift-edit` for interactive editing operations.

Consumers interact with document operations, not raw SQL, raw `Font` mutation, or edit-session internals.

## Responsibilities

- create and open durable Shift documents;
- coordinate writes to the SQLite working store;
- maintain the live `shift-ir` projection used by editing, rendering, and export;
- define where interactive edits become durable document state;
- provide Rust-native operations that bridge, CLI, and future app surfaces can wrap.

## Boundaries

`shift-document` should not contain raw SQL. SQL belongs in `shift-store`.

`shift-document` should not contain TypeScript or NAPI types. Those belong in `shift-bridge` and `shift-wire`.

`shift-document` should not implement low-level vector editing algorithms. Those belong in `shift-edit`.

`shift-document` should not treat SQLite as a pluggable backend. SQLite is the working store for editable Shift documents.

## API Language

Use document-domain language for public APIs:

- `NewDocument`;
- `ShiftDocument`.

Avoid transport, storage-abstraction, or version-control language in document APIs:

- request;
- backend;
- provider;
- store-backed;
- commit session.
