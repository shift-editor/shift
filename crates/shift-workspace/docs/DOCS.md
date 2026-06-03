# shift-workspace

Backend runtime object for an open Shift font workspace.

## Architecture Invariants

- **Architecture Invariant:** `FontWorkspace` composes the live `shift-font::Font`, the user-selected `shift-source` package, and the working `shift-store` database.
- **Architecture Invariant:** The `.shift` source package path and SQLite working store path are separate inputs.
- **Architecture Invariant:** The workspace is the domain object future bridge or utility-process transports should wrap.

## Codemap

```
crates/shift-workspace/src/
  lib.rs           -- public API barrel
  new_workspace.rs -- creation options for a fresh workspace
  workspace.rs     -- `FontWorkspace` and workspace errors
```

## Key Types

- `FontWorkspace` -- live backend object for one open font project.
- `NewWorkspace` -- options used when creating a new source package and working store.
- `WorkspaceError` -- source-package and store failures.

## How it works

`FontWorkspace::create_new(source_path, store_path, options)` creates a placeholder `.shift` package, opens the working SQLite store, writes initial font metadata, and starts with an empty `shift-font::Font`.

`FontWorkspace::open(source_path, store_path)` validates the existing source package, opens the working store, and starts with an empty in-memory font until source/store hydration is implemented.

## Verification

- `cargo test -p shift-workspace`

## Related

- `shift-source` -- user-authored `.shift` package layout.
- `shift-store` -- working SQLite store.
- `shift-font` -- live font object model.
