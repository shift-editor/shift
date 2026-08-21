# ADR 0001: Canonical SQLite `.shift` documents

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

Shift had two incompatible persistence meanings for the `.shift` extension:

1. a ZIP source package containing a JSON tree; and
2. a SQLite working store used for authoring, recovery, and lazy glyph payloads.

Keeping both made format detection, identity, Save, recovery, CLI behavior, and backend behavior depend on which path a caller selected. The ZIP format had not shipped as a compatibility boundary, so preserving it would create permanent ambiguity without protecting installed users.

The native store already provides independently compressed and verified layer payloads, relational indexes, stable document and commit identity, and bounded lazy reads. SQLite also provides the transaction and snapshot primitives needed for atomic Save and Save As without wrapping the database in another container.

## Decision

Every `.shift` file is a canonical SQLite application document.

- Canonical documents use SQLite `application_id` `0x53484654` and an exact supported `user_version`. Unknown application IDs and newer or otherwise unsupported document schemas are refused.
- `DocumentId` is authored document identity. Save preserves it, a raw filesystem copy or move preserves it, and Save As mints a new identity.
- The user-selected `.shift` file contains only saved authored truth. Unsaved changes live in an app-owned sparse `RecoveryOverlay` bound to the document identity and saved commit.
- Explicit Save reconciles commit identity and applies the sparse overlay in one canonical transaction. Discard clears the overlay. Save As snapshots the merged view into a validated sibling temporary database, installs it atomically, and adopts a fresh recovery overlay.
- Canonical connections use rollback journaling and `synchronous=FULL` so a clean, closed document has a one-file idle posture. Recovery overlays use WAL and `synchronous=FULL` outside the user document location.
- Document Open validates the header, required schema shape, full SQLite integrity, and foreign keys through a read-only connection before write access is allowed.
- Desktop, CLI, and `.shift` backend reads all enter through `ShiftStore` and `FontWorkspace`. Generic `FontLoader` writes to `.shift` are rejected because they would bypass document publication and identity semantics.
- The `shift-source` crate, ZIP reader/writer, package identities, package workspace variants, and compatibility tests are removed. There is no legacy ZIP fallback or format guessing.

## Consequences

- The extension has one format and one identity/recovery model across every product surface.
- A canonical document remains shareable as one SQLite file after clean close; recovery and derived caches are not embedded in it.
- Explicit Save remains meaningful even though each completed edit is already crash-durable in app-owned recovery storage.
- Pre-release ZIP `.shift` files are intentionally unsupported. This is a pre-freeze reset, not a migration promise.
- Future schema changes must advance `user_version` and add an explicit migration or lossless conversion path before that version can ship. Opening an unknown version must continue to fail without mutating the file.
- Hostile-input budgets, migration fault injection, and provider-specific cloud/copy testing remain follow-up hardening; they do not justify retaining a second document format.

## Superseded invariant

This decision supersedes the earlier assumption that Cmd+S publishes a complete ZIP `.shift` source package while SQLite remains a separate working copy. SQLite is now both the canonical saved document and the base for sparse app-owned recovery.

## Related documentation

- [`shift-store` canonical document boundary](../../../crates/shift-store/README.md)
- [`shift-workspace` document lifecycle](../../../crates/shift-workspace/docs/DOCS.md)
- [Electron main document ownership](../../../apps/desktop/src/main/docs/DOCS.md)
