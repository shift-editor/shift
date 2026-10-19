# De-risk spikes: engine, text folder, boring expansion

Reference harnesses from October 2026. They answer "would this work, and what
would it cost?" before production work starts. None of this ships, and spike
commits on this branch skip hooks.

This branch (`spike/engine-derisk`) is based on `feat/text-editing` plus step 0
(`spike/step0-edit-cost`). It also carries **engine changes made for the
spikes**, in `crates/`; those commits are listed below. They are working
references for implementors, not reviewed PRs.

Write-ups live in the Obsidian vault (`~/obsidian/KostyaVault/projects/shift/`).
Start from **"Index - Shift October 2026 Spikes and Plans"**, which links every
note below.

## Running

```bash
cd spikes/derisk
nix develop ../.. --command cargo test --release --test <spike> -- --nocapture --test-threads=1
# Large-font runs are #[ignore]d: add --ignored. Some write big temp folders; set SPIKE_DIR
# to a directory on a real disk (not tmpfs) for fsync numbers.
```

Fixtures: MutatorSans (in-repo), Roboto Flex
(`~/repos/designspace-stress/roboto-flex/sources/RobotoFlex.designspace`), and
Noto Sans CJK SC (`~/repos/rumil-core-or-tex/.cache/src/RaTeX/scripts/fonts/NotoSansCJKsc-Regular.otf`).

## Spikes

### Moving font-level edits into the renderer engine

Write-up: "Spike - Shift WASM Editing Engine and Step 0".

| Test | Question | Result |
|---|---|---|
| `spike1_unloaded_glyphs`, `spike1_scale` | Edits that reach glyphs the engine hasn't loaded | `required_loads` exact over 5,320 edits; anchor fan-out is 11–21 glyphs on real fonts |
| `spike2_snapshot` | Open from a native snapshot; kerning-heavy edits | Cheap with persistent kerning |
| `spike3_encoding`, `spike3_persist`, `spike3_native_undo_repro` | Changesets as the persistence format | Named MessagePack is the only exact format; 0 mismatches persisting. **Found the dirty-flag data-loss bug** (repro test) |
| `spike4_shaping` | Engine and shaping stay in step | Invalidation contract holds |
| `spike5_features` | Feature code as an engine intent | Compiles by revision in 1.5–6.5 ms |
| `spike8_derived_anchors` | Anchored placement as a query | 184/184 offsets reproduced; one write instead of 8–9 |

### `.shift` as a folder of text files

Write-up: "Ticket - Shift Document as a Text Folder" (design, crash safety, migration, prior art, web).

| Test | Question | Result |
|---|---|---|
| `spike9_text_folder` | Do per-glyph files bottleneck saves? | 3–5 ms per save; 84 ms for 1,000 glyphs with a `.syncing` marker plus one barrier (22 s → 4.7 s for a full CJK write) |
| `spike10_sync_in` | Outside changes (git checkout, scripts) reaching the open font | Branch switch, own-save filtering, unsaved-edit conflicts, conflict markers; 1,000-glyph CJK pull applies in ~0.3 s; stat-index rescan of 65k files in 231 ms |
| `spike11_font_level` | Sources, axes, kerning, groups, features, glyph order; undoing a pull | Plan font-level files first; engine gaps: no glyph-order change, no kerning reference check, components cache stale base names (rename bug confirmed). "Unsaved = differs from disk" makes undoing a pull a visible revert |
| `spike12_glyph_order` | Cost of a general glyph delete and reorder | 30 ms each on 65k glyphs; batches must renumber once (150 ms for 1,000) |

### Boring expansion (glyph-local axes, parts, decomposed export)

Write-up: "Plan - Boring Expansion Authoring Readiness" (sections "Sizing spike", "API prototype", "Completing the prototype").

| Test | Question | Result |
|---|---|---|
| `spike13_boring_expansion` | Decomposed export vs preview; per-occurrence cost | Exact unless scale or rotation shares an axis with a part's location; 89 ns per occurrence |
| `spike14_glyph_parts` | The additive model in code | No new `FontChange` kinds; round-trips the store and the text folder |
| `spike15_parts_export` | fontc-compiled parts vs preview (skrifa) | Within 1 unit with glyph-specific intermediate masters |
| `spike16_parts_documents` | v3 → v4 migration; crash recovery of unsaved parts | Exact through crash, recovery and save |
| `spike17_part_intents` | Editing parts through intents; validation | Undo and redo work; all 8 invalid edits rejected |

## Engine changes on this branch

| Commit | What |
|---|---|
| `9589939f` | Large change sets: index entity ids moved by difference, lazy glyph count in the store, parallel payload encoding, layer upserts (1,000-glyph batch 1.0–1.2 s → ~0.3 s) |
| `045f11c2` | Glyph-local axes and sources, additive: `GlyphAxis`, `LayerLocation`, `ComponentLocation`, `AxisInheritance`, `is_at_source`, `resolve_glyph` |
| `9a9b6a71` | `decompose_parts`, compiling font-axis-located layers in `shift2fontir`, layer-keyed glyph-space interpolation, schema v4 |
| `2c9d86c9` | Part intents and `validate_glyph_spaces` |

Other spike branches: `spike/step0-edit-cost` (step 0, PR quality),
`spike/renderer-writer` (renderer as the single writer, one undo timeline),
`spike/wasm-engine-renderer` (WASM engine harnesses, `spikes/README.md` there).
