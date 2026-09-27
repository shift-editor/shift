# fontsrc

<!-- reviewed: 2026-09-26 review-every: 90d -->

Format-native reading and writing for authored font sources across native, in-memory, and browser-owned storage.

## Architecture Invariants

**Architecture Invariant:** `fontsrc` never depends on a `shift-*` crate or exposes editor, workspace, persistence, or session identity. WHY: the library must remain independently usable by Rust, TypeScript, browser, and Node consumers.

**Architecture Invariant:** Format modules expose format-native values before any optional unified model. The `ufo` module uses Norad's `Font`, `FontSource`, and `FontSink` contracts without converting them into Shift's authored model. WHY: format-specific data and unknown `lib` content must survive without being narrowed to one editor's domain.

**Architecture Invariant:** Core format operations receive source-owned bytes through source and sink traits rather than assuming native paths. Filesystem implementations are adapters, not the parsing boundary. WHY: the same parser must operate over directories, archives, in-memory files, browser selections, and remote project trees.

**Architecture Invariant:** Unreleased upstream source/sink APIs are pinned to an exact Git revision. WHY: browser-safe I/O is currently ahead of Norad's published crate API and must not drift underneath reproducible builds.

## Codemap

```text
crates/fontsrc/
  src/
    lib.rs               -- format modules and public format-native exports
  tests/
    ufo_source.rs        -- in-memory UFO read and write equivalence
```

The [README](../README.md) provides the minimal Rust usage and incubation scope.

## Key Types

- `ufo::FontSource` — reads UFO-relative files from any synchronous backing source.
- `ufo::FontSink` — writes UFO-relative files without assuming a destination filesystem.
- `ufo::Font` — Norad's format-native UFO model.
- `ufo::DataRequest` — selects which UFO data is materialized.

## How it works

A host provides a `FontSource` whose paths are relative to a UFO root. Norad parses those bytes into its native `Font` model. Native callers may use a directory implementation; browser and remote adapters can first gather files asynchronously and then expose the resulting immutable byte map synchronously to the parser or worker.

Writing follows the inverse boundary: `Font::save_to_sink` serializes relative files through a host-owned `FontSink`. Destination replacement, stale-file cleanup, upload, and persistence remain host responsibilities.

## Workflow recipes

### Add a format capability

1. Keep the public values format-native.
2. Accept bytes, readers, or source/sink traits rather than requiring native paths.
3. Add fixture-backed equivalence tests against the upstream native-path behavior.
4. Verify the crate has no `shift-*` dependency.
5. Check native and `wasm32-unknown-unknown` builds.

## Gotchas

- `FontSource` is synchronous. Browser adapters should perform asynchronous file acquisition outside the parser, preferably in a worker, and expose an immutable in-memory source while parsing.
- UFO data and image directories require `FontSource::list_dir`; sources that omit enumeration intentionally produce empty stores.
- `FontSink` does not remove stale destination files. Hosts must clear or replace destinations when complete replacement semantics are required.

## Verification

```bash
cargo test -p fontsrc
cargo check --target wasm32-unknown-unknown -p fontsrc
if cargo tree -p fontsrc --edges normal --prefix none | grep -q '^shift-'; then
  echo "fontsrc must not depend on shift-* crates"
  exit 1
fi
```

## Related

- [Architecture routing](../../../docs/architecture/index.md)
- [Shift format adapters](../../shift-backends/docs/DOCS.md)
- [Standalone fontsrc repository](https://github.com/shift-editor/fontsrc)
- [Norad](https://github.com/linebender/norad)
