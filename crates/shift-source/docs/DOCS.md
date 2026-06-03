# shift-source

Placeholder source-package crate for Shift's user-authored `.shift` format.

## Architecture Invariants

- **Architecture Invariant:** `.shift` is the user-selected source package path. It is separate from the working SQLite store path.
- **Architecture Invariant:** This crate owns source-package file-system layout, not the live font object model or incremental working DB.
- **Architecture Invariant:** The current package is intentionally minimal: a directory ending in `.shift` with a `manifest.json` file.

## Codemap

```
crates/shift-source/src/
  lib.rs      -- public API barrel
  package.rs  -- package creation/opening and path validation
```

## Key Types

- `ShiftSourcePackage` -- opened or newly created `.shift` package directory.
- `SourcePackageError` -- typed source-package file-system and validation failures.

## How it works

`ShiftSourcePackage::create_empty(path)` validates that the path ends in `.shift`, creates the directory, and writes a placeholder `manifest.json`.

`ShiftSourcePackage::open(path)` validates that the directory and manifest exist.

## Verification

- `cargo test -p shift-source`

## Related

- `shift-workspace` -- composes source package, working store, and live font model.
- `shift-store` -- working SQLite store.
- `shift-font` -- live font object model.
