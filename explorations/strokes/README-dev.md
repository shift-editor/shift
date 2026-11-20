# Strokes dev hook (`explore/strokes`)

Hand-test stroke intents **without the editor UI**. Run inside the Nix dev shell from the repo root.

The `.shift` path is a **positional argument** (there is no `--path` flag).

```bash
nix develop --command cargo run -p shift-cli -- glyph stroke <subcommand> PATH.shift --glyph <name> …
```

Or: `./explorations/strokes/dev-hook.sh glyph stroke <subcommand> …`

## Quick start (Solenoid)

```bash
# dry-run is safe on the checked-in fixture; copy first when you want to save
nix develop --command cargo run -p shift-cli -- glyph stroke set-live-stroke \
  fixtures/fonts/Solenoid.shift --glyph dot --width 20 --dry-run

cp fixtures/fonts/Solenoid.shift /tmp/stroke-play.shift
nix develop --command cargo run -p shift-cli -- glyph stroke set-live-stroke \
  /tmp/stroke-play.shift --glyph dot --width 20
nix develop --command cargo run -p shift-cli -- glyph stroke preview \
  /tmp/stroke-play.shift --glyph dot
```

`glyph inspect fixtures/fonts/Solenoid.shift dot` shows `dot` has one closed square contour on both masters (`Regular`, `Bled`), not components. Use `inspect --view glyphs fixtures/fonts/Solenoid.shift` for other names. Prefer `dot` or `dollar` (own contours); `H` / `colon` are component-only and fail live stroke with `no contours`.

Dry-run without writing: add `--dry-run` to any stroke subcommand.

## Commands

| Goal                       | Example                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| Destructive outline (A1)   | `… glyph stroke outline-stroke /tmp/stroke-play.shift --glyph dot --width 20`    |
| Offset closed path (A1.2)  | `… glyph stroke offset-contour /tmp/stroke-play.shift --glyph dot --distance 10` |
| Attach live stroke (A2)    | `… glyph stroke set-live-stroke /tmp/stroke-play.shift --glyph dot --width 20`   |
| Preview bounds (read-only) | `… glyph stroke preview /tmp/stroke-play.shift --glyph dot`                      |
| Bake live stroke           | `… glyph stroke bake-stroke /tmp/stroke-play.shift --glyph dot`                  |

Optional: `--cap butt|square|round`, `--join bevel|miter|round`, `--miter-limit N`, `--source MasterName`, `--tolerance 0.25`.

Help: `… glyph stroke --help` and `… glyph stroke set-live-stroke --help`.

## Fixture workflow

See `crates/shift-font/tests/fixtures/stroke/*.json` for path geometry. Or import a UFO/designspace with `shift import … --output /tmp/foo.shift` first.

Rust tests: `cargo test -p shift-font --lib stroke::` and `live_stroke` module tests.
