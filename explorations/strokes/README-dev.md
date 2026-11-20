# Strokes dev hook (`explore/strokes`)

Hand-test stroke intents **without the editor UI**. Run inside the Nix dev shell:

```bash
nix develop --command cargo run -p shift-cli -- <subcommand> …
```

## Prerequisites

- A canonical `.shift` document with a glyph that has at least one contour on the default (or named) source.
- For **offset**, the first contour on the layer should be **closed**.

## Commands

| Goal | Command |
| ---- | ------- |
| Destructive outline (A1) | `shift glyph stroke outline-stroke --path FONT.shift --glyph G --width 20` |
| Offset closed path (A1.2) | `shift glyph stroke offset-contour --path FONT.shift --glyph G --distance 10` |
| Attach live stroke (A2.1) | `shift glyph stroke set-live-stroke --path FONT.shift --glyph G --width 20` |
| Preview bounds (read-only) | `shift glyph stroke preview --path FONT.shift --glyph G` |
| Bake live stroke (A2.2) | `shift glyph stroke bake-stroke --path FONT.shift --glyph G` |

Optional flags on stroke commands: `--cap butt|square|round`, `--join bevel|miter|round`, `--miter-limit N`, `--source MasterName`, `--tolerance 0.25`.

## Wrapper script

[`dev-hook.sh`](./dev-hook.sh) forwards to `shift-cli` when built; pass the same args after the script name.

## Fixture workflow (JSON glyph)

1. Create a font: `shift font create /tmp/stroke-test.shift`
2. Add a layer from JSON (see `crates/shift-font/tests/fixtures/stroke/*.json` for path geometry ideas) via `shift layer add …` — see `shift-cli` skill for layer payload shape.
3. Run the stroke commands above on the glyph name you used.

Rust tests for A2 live under `crates/shift-font/src/stroke/live_stroke.rs` and `shift-store` MessagePack round-trip.