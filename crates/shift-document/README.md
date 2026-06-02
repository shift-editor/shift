# shift-document

`shift-document` owns the Rust-side workflow for an open Shift document.

A document coordinates the lower-level crates:

- `shift-store` for the SQLite working store;
- `shift-font` for the live authoring model and interactive editing operations.

Consumers interact with document operations, not low-level SQL, raw `Font` mutation, or edit-session internals.

## Responsibilities

- create and open durable Shift documents;
- coordinate writes to the SQLite working store;
- maintain the live `shift-font` projection used by editing, rendering, and export;
- define where interactive edits become durable document state;
- provide Rust-native operations that bridge, CLI, and future app surfaces can wrap.

## Boundaries

`shift-document` should not contain low-level SQL. SQL belongs in `shift-store`.

`shift-document` should not contain TypeScript or NAPI types. Those belong in `shift-bridge` and `shift-wire`.

`shift-document` should not implement low-level vector editing algorithms. Those belong in `shift-font`.

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
