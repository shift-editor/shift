//! Spike 4: the engine and shaping stay in step.
//!
//! After every engine edit, undo, and redo, shaping refreshed only as
//! `shaping_invalidation` asks must equal shaping rebuilt from scratch, from
//! the engine's font and from the native workspace that ran the same edits.

use std::path::{Path, PathBuf};
use std::time::Instant;

use engine_derisk::shaping::{shaping_invalidation, units, EngineGlyphs, EngineShaping};
use shift_backends::shaper_font::{ShaperFont, ShaperFontRequest};
use shift_font::{
    AnchorId, AnchorSeed, Font, FontChangeSet, FontIntent, FontIntentSet, GlyphId, GlyphName,
    LayerId,
};
use shift_shape::{ShapedParagraph, Unit};
use shift_workspace::FontWorkspace;

const CORPUS: &[&str] = &[
    "fi", "ffi", "f i", "if", "fifi", "\u{628}\u{628}", "\u{628}\u{628}\u{628}",
    "\u{646}\u{651}\u{64E}", "\u{628}\u{64E}\u{628}", "f \u{628} i", "{tick}fi", "a", "aa",
    "\u{2713}", "\u{646}", "fa", "f\u{2713}i",
];

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts").join(name)
}

fn corpus(font: &Font) -> Vec<Vec<Unit<GlyphId>>> {
    CORPUS.iter().map(|line| units(font, line)).collect()
}

/// Shaping rebuilt from nothing: a fresh compile and a fresh character map.
fn rebuilt(font: &Font) -> Vec<ShapedParagraph<GlyphId>> {
    EngineShaping::new(font).shape_corpus(&corpus(font))
}

struct Pair {
    native: FontWorkspace,
    engine: Font,
    /// Refreshed only as `shaping_invalidation` asks.
    shaping: EngineShaping,
    /// Recompiled and remapped at every step, keeping the last valid font as
    /// the workspace's shaper state does.
    every_step_engine: EngineShaping,
    every_step_native: EngineShaping,
    undo: Vec<FontChangeSet>,
    redo: Vec<FontChangeSet>,
    _dir: tempfile::TempDir,
}

impl Pair {
    fn open(fixture_name: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut native =
            FontWorkspace::open(fixture(fixture_name), dir.path().join("store.sqlite")).unwrap();
        native.acquire_all_layers().unwrap();
        // The engine opens from a snapshot of the native font, as it would in the renderer.
        let engine: Font =
            serde_json::from_str(&serde_json::to_string(native.font()).unwrap()).unwrap();
        let shaping = EngineShaping::new(&engine);
        let every_step_engine = EngineShaping::new(&engine);
        let every_step_native = EngineShaping::new(native.font());
        Self {
            native,
            engine,
            shaping,
            every_step_engine,
            every_step_native,
            undo: Vec::new(),
            redo: Vec::new(),
            _dir: dir,
        }
    }

    fn check(&mut self, step: &str) {
        let lines = corpus(&self.engine);
        let incremental = self.shaping.shape_corpus(&lines);
        self.every_step_engine.recompile(&self.engine);
        let from_engine = self.every_step_engine.shape_corpus(&lines);
        self.native.acquire_all_layers().unwrap();
        self.every_step_native.recompile(self.native.font());
        let from_native = self.every_step_native.shape_corpus(&lines);
        assert_eq!(incremental, from_engine, "{step}: incremental vs engine rebuilt every step");
        assert_eq!(from_engine, from_native, "{step}: engine vs native");
        // With valid feature code, history does not matter: a fresh rebuild agrees too.
        if self.shaping.diagnostics() == 0 {
            assert_eq!(incremental, rebuilt(&self.engine), "{step}: incremental vs fresh rebuild");
        }
        assert_eq!(
            ShaperFontRequest::from_font(&self.engine).unwrap(),
            ShaperFontRequest::from_font(self.native.font()).unwrap(),
            "{step}: shaper font inputs"
        );
    }

    fn apply(&mut self, step: &str, intents: Vec<FontIntent>) {
        let applied = self
            .engine
            .apply_intents(FontIntentSet {
                intents: intents.clone(),
            })
            .unwrap();
        let invalidation = shaping_invalidation(&applied.changes, &self.engine);
        self.shaping.refresh(invalidation, &self.engine);
        self.native
            .apply(FontIntentSet { intents }, None)
            .unwrap();
        self.undo.push(applied.changes);
        self.redo.clear();
        self.check(step);
    }

    fn undo(&mut self, step: &str) {
        let changes = self.undo.pop().unwrap();
        let inverse = changes.inverted();
        self.engine.apply_change_set(&inverse).unwrap();
        self.shaping
            .refresh(shaping_invalidation(&inverse, &self.engine), &self.engine);
        self.native.undo().unwrap().unwrap();
        self.redo.push(changes);
        self.check(step);
    }

    fn redo(&mut self, step: &str) {
        let changes = self.redo.pop().unwrap();
        self.engine.apply_change_set(&changes).unwrap();
        self.shaping
            .refresh(shaping_invalidation(&changes, &self.engine), &self.engine);
        self.native.redo().unwrap().unwrap();
        self.undo.push(changes);
        self.check(step);
    }

    fn default_layer(&self, glyph: &str) -> LayerId {
        let source = self.engine.default_source_id().unwrap();
        self.engine
            .glyph_by_name(glyph)
            .unwrap()
            .layer_for_source(source)
            .unwrap()
            .id()
    }

    fn create_glyph(name: &str, unicodes: Vec<u32>, source: shift_font::SourceId) -> Vec<FontIntent> {
        Self::create_glyph_with_id(GlyphId::new(), name, unicodes, source)
    }

    fn create_glyph_with_id(
        glyph_id: GlyphId,
        name: &str,
        unicodes: Vec<u32>,
        source: shift_font::SourceId,
    ) -> Vec<FontIntent> {
        vec![
            FontIntent::CreateGlyph {
                glyph_id: Some(glyph_id.clone()),
                name: name.to_string(),
                unicodes,
            },
            FontIntent::CreateGlyphLayer {
                layer_id: LayerId::new(),
                glyph_id,
                source_id: source,
            },
        ]
    }
}

#[test]
fn engine_shaping_matches_a_native_rebuild_through_edits_undo_and_redo() {
    let mut pair = Pair::open("ShapingTest.ufo");
    pair.check("open");
    let source = pair.engine.default_source_id().unwrap();
    let tick = pair.engine.glyph_id_by_name("tick").unwrap();
    let f = pair.engine.glyph_id_by_name("f").unwrap();
    let f_alt = GlyphId::new();

    let steps: Vec<(&str, Vec<FontIntent>)> = vec![
        ("create a with U+0061", Pair::create_glyph("a", vec![0x61], source.clone())),
        (
            "create f.alt also claiming f",
            Pair::create_glyph_with_id(f_alt.clone(), "f.alt", vec![0x66], source.clone()),
        ),
        (
            "give tick U+2713",
            vec![FontIntent::UpdateGlyph {
                glyph_id: tick.clone(),
                new_name: GlyphName::new("tick").unwrap(),
                new_unicodes: vec![0x2713],
            }],
        ),
        (
            "move f's unicode to nothing",
            vec![FontIntent::UpdateGlyph {
                glyph_id: f.clone(),
                new_name: GlyphName::new("f").unwrap(),
                new_unicodes: vec![],
            }],
        ),
        (
            "rename f.alt to f_alt (features do not name it)",
            vec![FontIntent::UpdateGlyph {
                glyph_id: f_alt.clone(),
                new_name: GlyphName::new("f_alt").unwrap(),
                new_unicodes: vec![0x66],
            }],
        ),
        (
            "widen tick",
            vec![FontIntent::SetXAdvance {
                layer_id: pair.default_layer("tick"),
                width: 777.0,
            }],
        ),
        (
            "give tick a top anchor (becomes a GDEF base)",
            vec![FontIntent::AddAnchors {
                layer_id: pair.default_layer("tick"),
                anchors: vec![AnchorSeed {
                    id: AnchorId::from_raw("tick_top"),
                    name: Some("top".to_string()),
                    x: 100.0,
                    y: 500.0,
                }],
            }],
        ),
        (
            "rename tick's anchor to _top (no longer a base)",
            vec![FontIntent::RenameAnchors {
                layer_id: pair.default_layer("tick"),
                anchor_ids: vec![AnchorId::from_raw("tick_top")],
                names: vec!["_top".to_string()],
            }],
        ),
        (
            "add a ligature rule for a a",
            vec![FontIntent::SetFeatureSource {
                source: Some(format!(
                    "{}\nfeature liga {{ sub a a by tick; }} liga;\n",
                    pair.engine.features().fea_source().unwrap_or_default()
                )),
            }],
        ),
    ];

    let count = steps.len();
    for (name, intents) in steps {
        pair.apply(name, intents);
    }
    for step in 0..count {
        pair.undo(&format!("undo {step}"));
    }
    for step in 0..count {
        pair.redo(&format!("redo {step}"));
    }
    // A rename that breaks a feature reference keeps the last valid shaper font.
    pair.apply(
        "rename i, breaking `sub f i by f_i`",
        vec![FontIntent::UpdateGlyph {
            glyph_id: pair.engine.glyph_id_by_name("i").unwrap(),
            new_name: GlyphName::new("idotless").unwrap(),
            new_unicodes: vec![0x69],
        }],
    );
    assert!(pair.shaping.diagnostics() > 0, "the broken reference is reported");
    pair.undo("undo the breaking rename");
    assert_eq!(pair.shaping.diagnostics(), 0);
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

#[test]
fn incremental_invalidation_is_sufficient_under_random_edits() {
    let mut false_positive_recompiles = 0;
    let mut needed_recompiles = 0;
    let mut needed_remaps = 0;
    let mut steps_total = 0;
    for seed in 1..=12u64 {
        let mut rng = Lcg(seed);
        let mut pair = Pair::open("ShapingTest.ufo");
        let source = pair.engine.default_source_id().unwrap();
        for step in 0..30 {
            steps_total += 1;
            let before_request = ShaperFontRequest::from_font(&pair.engine).unwrap();
            let before_cmap = pair.shaping.glyphs().registration();
            let names: Vec<String> = pair.engine.glyphs().map(|g| g.name().to_string()).collect();
            let pick = names[rng.below(names.len())].clone();
            let glyph_id = pair.engine.glyph_id_by_name(&pick).unwrap();
            let label = format!("seed {seed} step {step}");
            match rng.below(9) {
                0 | 1 if !pair.undo.is_empty() => pair.undo(&label),
                2 if !pair.redo.is_empty() => pair.redo(&label),
                3 => pair.apply(
                    &label,
                    Pair::create_glyph(
                        &format!("new{seed}_{step}"),
                        vec![0x61 + rng.below(4) as u32],
                        source.clone(),
                    ),
                ),
                4 => pair.apply(
                    &label,
                    vec![FontIntent::UpdateGlyph {
                        glyph_id,
                        new_name: GlyphName::new(pick.as_str()).unwrap(),
                        new_unicodes: vec![0x61 + rng.below(6) as u32],
                    }],
                ),
                5 => pair.apply(
                    &label,
                    vec![FontIntent::SetXAdvance {
                        layer_id: pair.default_layer(&pick),
                        width: 100.0 + rng.below(900) as f64,
                    }],
                ),
                6 => pair.apply(
                    &label,
                    vec![FontIntent::AddAnchors {
                        layer_id: pair.default_layer(&pick),
                        anchors: vec![AnchorSeed {
                            id: AnchorId::new(),
                            name: Some(if rng.below(2) == 0 { "top" } else { "_top" }.to_string()),
                            x: 0.0,
                            y: 0.0,
                        }],
                    }],
                ),
                7 => pair.apply(
                    &label,
                    vec![FontIntent::SetFeatureSource {
                        source: Some(format!(
                            "languagesystem DFLT dflt;\nfeature liga {{ sub f i by f_i; }} liga;\n# {step}\n"
                        )),
                    }],
                ),
                _ => continue,
            }
            let after_request = ShaperFontRequest::from_font(&pair.engine).unwrap();
            let after_cmap = EngineGlyphs::new(
                &ShaperFont::compile(&after_request).unwrap().font.unwrap(),
                &pair.engine,
            )
            .registration();
            if before_request != after_request {
                needed_recompiles += 1;
            }
            if before_cmap != after_cmap {
                needed_remaps += 1;
            }
            let _ = &mut false_positive_recompiles;
        }
    }
    eprintln!(
        "random: {steps_total} steps, {needed_recompiles} needed a recompile, {needed_remaps} a remap, all incremental == rebuilt"
    );
}

#[test]
fn contract_never_under_invalidates_and_reports_its_false_positives() {
    // Compare the contract with the exact oracle (request and cmap equality)
    // for each kind of edit, from a fresh font each time.
    let mut rows = Vec::new();
    let cases: Vec<(&str, Box<dyn Fn(&Font) -> Vec<FontIntent>>)> = vec![
        ("create glyph", Box::new(|font| Pair::create_glyph("zz", vec![0x7A], font.default_source_id().unwrap()))),
        ("change unicodes", Box::new(|font| vec![FontIntent::UpdateGlyph { glyph_id: font.glyph_id_by_name("tick").unwrap(), new_name: GlyphName::new("tick").unwrap(), new_unicodes: vec![0x2713] }])),
        ("rename", Box::new(|font| vec![FontIntent::UpdateGlyph { glyph_id: font.glyph_id_by_name("tick").unwrap(), new_name: GlyphName::new("checkmark").unwrap(), new_unicodes: vec![] }])),
        ("advance", Box::new(|font| vec![FontIntent::SetXAdvance { layer_id: font.glyph_by_name("tick").unwrap().layer_for_source(font.default_source_id().unwrap()).unwrap().id(), width: 321.0 }])),
        ("attaching anchor", Box::new(|font| vec![FontIntent::AddAnchors { layer_id: font.glyph_by_name("tick").unwrap().layer_for_source(font.default_source_id().unwrap()).unwrap().id(), anchors: vec![AnchorSeed { id: AnchorId::new(), name: Some("top".into()), x: 0.0, y: 0.0 }] }])),
        ("mark anchor on a mark", Box::new(|font| vec![FontIntent::AddAnchors { layer_id: font.glyph_by_name("fatha-ar").unwrap().layer_for_source(font.default_source_id().unwrap()).unwrap().id(), anchors: vec![AnchorSeed { id: AnchorId::new(), name: Some("_top".into()), x: 0.0, y: 0.0 }] }])),
        ("feature source", Box::new(|_| vec![FontIntent::SetFeatureSource { source: Some("feature liga { sub f i by f_i; } liga;".into()) }])),
    ];
    for (name, intents) in cases {
        let pair = Pair::open("ShapingTest.ufo");
        let mut font = pair.engine.clone();
        let before = ShaperFontRequest::from_font(&font).unwrap();
        let before_font = ShaperFont::compile(&before).unwrap().font.unwrap();
        let before_cmap = EngineGlyphs::new(&before_font, &font).registration();
        let applied = font.apply_intents(FontIntentSet { intents: intents(&font) }).unwrap();
        let contract = shaping_invalidation(&applied.changes, &font);
        let after = ShaperFontRequest::from_font(&font).unwrap();
        let needs_recompile = before != after;
        // The map through the old shaper font: what a remap without a recompile gives.
        let needs_remap = EngineGlyphs::new(&before_font, &font).registration() != before_cmap;
        assert!(!needs_recompile || contract.shaper_font, "{name}: missed a recompile");
        assert!(!needs_remap || contract.cmap || contract.shaper_font, "{name}: missed a remap");
        rows.push(format!(
            "{name:<22} contract {contract:?}  oracle recompile={needs_recompile} remap={needs_remap}"
        ));
    }
    eprintln!("{}", rows.join("\n"));
}

#[test]
#[ignore = "imports a 65k-glyph font; run with --ignored"]
fn cmap_registration_cost_on_a_cjk_font() {
    let path = "/home/kostyafarber/repos/rumil-core-or-tex/.cache/src/RaTeX/scripts/fonts/NotoSansCJKsc-Regular.otf";
    let dir = tempfile::tempdir().unwrap();
    let start = Instant::now();
    let workspace = FontWorkspace::open(path, dir.path().join("store.sqlite")).unwrap();
    eprintln!("import {:?}", start.elapsed());
    let font = workspace.font();
    let request = ShaperFontRequest::from_font(font).unwrap();
    let start = Instant::now();
    let compiled = ShaperFont::compile(&request).unwrap().font.unwrap();
    eprintln!("compile shaper font (no layers loaded) {:?}, {} bytes", start.elapsed(), compiled.bytes().len());
    let start = Instant::now();
    let glyphs = EngineGlyphs::new(&compiled, font);
    let build = start.elapsed();
    let (codepoints, shaper_glyphs) = glyphs.registration();
    let start = Instant::now();
    let mut remapped = glyphs;
    remapped.remap(font);
    eprintln!(
        "cmap build {build:?}, remap {:?}, {} pairs = {} KB as two Float64Arrays",
        start.elapsed(),
        codepoints.len(),
        (codepoints.len() + shaper_glyphs.len()) * 8 / 1024
    );
}
