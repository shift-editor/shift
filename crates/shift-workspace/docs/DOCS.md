# shift-workspace

Backend runtime object for an open Shift font workspace.

## Architecture Invariants

- **Architecture Invariant:** `FontWorkspace` composes the live `shift-font::Font`, the user-selected `shift-source` package, and the working `shift-store` database.
- **Architecture Invariant:** The `.shift` source package path and SQLite working store path are separate inputs.
- **Architecture Invariant:** Package recovery policy is not ranked in Rust. `FontWorkspace` exposes package and working-store inspection primitives; the utility process owns binding and lifecycle decisions.
- **Architecture Invariant:** The workspace is the domain object future bridge or utility-process transports should wrap.
- **Architecture Invariant:** Ledger replay restores complete named-instance collections after axis topology so undo/redo never observes an instance against the wrong external-axis shape.

## Codemap

```
crates/shift-workspace/src/
  lib.rs           -- public API barrel
  new_workspace.rs -- creation options for a fresh workspace
  source_identity.rs -- package identity snapshots and source-save validation
  workspace.rs     -- `FontWorkspace` and workspace errors
```

## Key Types

- `FontWorkspace` -- live backend object for one open font project.
- `NewWorkspace` -- options used when creating a new source package and working store.
- `PackageIdentity` -- package id, canonical path, and fingerprint for one `.shift` source.
- `PackageDraft` -- package ownership and dirty/base fingerprint state read from a working store.
- `WorkspaceSource` -- explicit source state: saved `.shift` package or imported external file.
- `WorkspaceError` -- source-package and store failures.

## How it works

`FontWorkspace::create(source_path, store_path, options)` creates a placeholder `.shift` package, opens the working SQLite store, writes initial font metadata, and starts with an empty `shift-font::Font`.

`FontWorkspace::open(path, store_path)` detects `.shift` paths as source packages. Other supported font paths are imported through `shift-backends` into an unsaved workspace with no save target.

`FontWorkspace::save()` succeeds for saved `.shift` workspaces and returns `NeedsSaveAs` for imported workspaces. `save_as(path)` creates a `.shift` package and makes it the save target.

`FontWorkspace::inspect_package(path)` reads a `.shift` package without opening it as the live workspace. It returns the stable package id, canonical path, and fingerprint used by the utility process to address a package instance.

`FontWorkspace::inspect_package_draft(store_path)` reads the working-store package ownership record without resuming it. It returns the package id, source path, base fingerprint, document id, and dirty flag so the utility process can choose an explicit open transition.

## Verification

- `cargo test -p shift-workspace`

## Related

- `shift-source` -- user-authored `.shift` package layout.
- `shift-store` -- working SQLite store.
- `shift-font` -- live font object model.
