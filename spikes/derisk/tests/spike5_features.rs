//! Spike 5: feature code as an engine intent, compiled natively by revision.
//!
//! The engine applies `SetFeatureSource` synchronously and undoably; every
//! edit that changes shaper-font inputs makes a new revision. The workspace
//! compiles revisions asynchronously on one worker, coalescing to the latest;
//! the editor accepts a result only when it is newer than what it has, keeps
//! shaping with the last valid font while the source has errors, and shows
//! diagnostics with the revision they were compiled from.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use engine_derisk::shaping::{shaping_invalidation, units, EngineGlyphs};
use shift_backends::shaper_font::{
    FeatureDiagnostic, ShaperFont, ShaperFontCompilation, ShaperFontRequest,
};
use shift_font::{Font, FontChangeSet, FontIntent, FontIntentSet, GlyphId};
use shift_shape::{NormalizedCoord, ParagraphRequest, ShapedParagraph, Shaper, Unit};
use shift_workspace::FontWorkspace;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts").join(name)
}

/// Real fonts with substantial feature code, as UFOs.
const REAL_FONTS: &[&str] = &[
    "/home/kostyafarber/repos/math-font-sources/stixfonts/source/STIXTwoText-Italic.ufo",
    "/home/kostyafarber/.cargo/git/checkouts/babelfont-rs-60beec10863320b2/d157aa5/babelfont/resources/NotoSans-LightItalic.ufo",
    "/home/kostyafarber/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/close_already-0.3.5/benches/data/Roboto-Regular.ufo",
];

fn open(name: &str) -> (Font, tempfile::TempDir) {
    open_path(&fixture(name))
}

fn open_path(path: &Path) -> (Font, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(path, dir.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    let font: Font = serde_json::from_str(&serde_json::to_string(workspace.font()).unwrap()).unwrap();
    (font, dir)
}

fn shape(font: &Font, shaper_font: &ShaperFont, lines: &[&str]) -> Vec<ShapedParagraph<GlyphId>> {
    let shaper = Shaper::new(shaper_font.bytes().to_vec()).unwrap();
    let glyphs = EngineGlyphs::new(shaper_font, font);
    let coords: Vec<NormalizedCoord> = shaper_font
        .axis_normalizations()
        .iter()
        .map(|(_, normalization)| normalization.normalize(None))
        .collect();
    lines
        .iter()
        .map(|line| {
            let units: Vec<Unit<GlyphId>> = units(font, line);
            let request = ParagraphRequest {
                units: &units,
                location: coords.as_slice(),
                language: None,
                features: &[],
            };
            shaper.shape_paragraph(&glyphs, &request).unwrap()
        })
        .collect()
}

/// One revision the engine produced: its shaper-font inputs and source text.
struct Revision {
    request: ShaperFontRequest,
    /// The same inputs without feature code, which always compile: the
    /// workspace shapes with it while no feature code has compiled yet.
    featureless: ShaperFontRequest,
    source: String,
}

/// The engine side: applies feature edits and undo/redo, numbering a new
/// revision whenever shaper-font inputs change.
struct Engine {
    font: Font,
    undo: Vec<FontChangeSet>,
    redo: Vec<FontChangeSet>,
    revisions: Vec<Revision>,
}

impl Engine {
    fn new(font: Font) -> Self {
        let mut engine = Self {
            font,
            undo: Vec::new(),
            redo: Vec::new(),
            revisions: Vec::new(),
        };
        engine.record();
        engine
    }

    fn record(&mut self) {
        let mut featureless = self.font.clone();
        featureless.features_mut().set_fea_source(None);
        self.revisions.push(Revision {
            request: ShaperFontRequest::from_font(&self.font).unwrap(),
            featureless: ShaperFontRequest::from_font(&featureless).unwrap(),
            source: self.font.features().fea_source().unwrap_or_default().to_string(),
        });
    }

    fn after_change(&mut self, changes: &FontChangeSet) {
        if shaping_invalidation(changes, &self.font).shaper_font {
            self.record();
        }
    }

    fn set_source(&mut self, source: &str) {
        let applied = self
            .font
            .apply_intents(FontIntentSet {
                intents: vec![FontIntent::SetFeatureSource {
                    source: Some(source.to_string()),
                }],
            })
            .unwrap();
        self.redo.clear();
        self.after_change(&applied.changes);
        self.undo.push(applied.changes);
    }

    fn undo(&mut self) {
        let changes = self.undo.pop().unwrap();
        let inverse = changes.inverted();
        self.font.apply_change_set(&inverse).unwrap();
        self.after_change(&inverse);
        self.redo.push(changes);
    }

    fn redo(&mut self) {
        let changes = self.redo.pop().unwrap();
        self.font.apply_change_set(&changes).unwrap();
        self.after_change(&changes);
        self.undo.push(changes);
    }

    fn latest(&self) -> u64 {
        self.revisions.len() as u64 - 1
    }
}

/// The workspace side: compiles revisions, caching by inputs so undo back to
/// earlier text costs nothing.
#[derive(Default)]
struct Compiler {
    cache: HashMap<String, (Arc<ShaperFontCompilation>, f64)>,
    hits: usize,
    compiles: Vec<f64>,
    any_font: bool,
    fallbacks: usize,
}

impl Compiler {
    /// Compiles one revision, returning the result and its cost in ms.
    fn compile(&mut self, revision: &Revision) -> (Arc<ShaperFontCompilation>, f64) {
        let key = format!("{:?}", revision.request);
        if let Some((compilation, _)) = self.cache.get(&key) {
            self.hits += 1;
            return (compilation.clone(), 0.0);
        }
        let start = Instant::now();
        let mut compilation = ShaperFont::compile(&revision.request).unwrap();
        // The workspace's shaper state: errors keep the previous font; with
        // none yet, it falls back to the font without feature code. The
        // editor keeps its own last valid font, so the fallback only matters
        // until anything has compiled.
        if compilation.font.is_none() && !self.any_font {
            compilation.font = ShaperFont::compile(&revision.featureless).unwrap().font;
            self.fallbacks += 1;
        }
        self.any_font |= compilation.font.is_some();
        let compilation = Arc::new(compilation);
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        self.compiles.push(ms);
        self.cache.insert(key, (compilation.clone(), ms));
        (compilation, ms)
    }
}

/// The editor side: the newest accepted revision, the last valid font, and
/// diagnostics tagged with the revision they describe.
#[derive(Default)]
struct Editor {
    accepted: Option<u64>,
    font: Option<(u64, ShaperFont)>,
    diagnostics: Option<(u64, Vec<FeatureDiagnostic>)>,
    stale_dropped: usize,
}

impl Editor {
    fn receive(&mut self, revision: u64, compilation: &ShaperFontCompilation) {
        if self.accepted.is_some_and(|accepted| revision <= accepted) {
            self.stale_dropped += 1;
            return;
        }
        self.accepted = Some(revision);
        self.diagnostics = Some((revision, compilation.diagnostics.clone()));
        if let Some(font) = &compilation.font {
            self.font = Some((revision, font.clone()));
        }
    }
}

/// Typing a new feature into existing code, a few characters per edit, with
/// undos and redos: intermediate states do not compile.
fn typing_session(base: &str, rule: &str) -> Vec<Action> {
    let mut actions = Vec::new();
    for end in (4..=rule.len()).step_by(4).chain([rule.len()]) {
        actions.push(Action::Set(format!("{base}\n{}", &rule[..end])));
    }
    actions.extend([Action::Undo, Action::Undo, Action::Redo, Action::Undo, Action::Redo, Action::Redo]);
    actions
}

#[derive(Clone, Debug)]
enum Action {
    Set(String),
    Undo,
    Redo,
}

fn apply(engine: &mut Engine, action: &Action) {
    match action {
        Action::Set(source) => engine.set_source(source),
        Action::Undo => engine.undo(),
        Action::Redo => engine.redo(),
    }
}

/// Checks a diagnostic set against the source of the revision it came from.
fn diagnostics_fit(revision: &Revision, diagnostics: &[FeatureDiagnostic]) -> bool {
    let utf16_len = revision.source.encode_utf16().count();
    diagnostics
        .iter()
        .all(|diagnostic| diagnostic.range.start <= diagnostic.range.end && diagnostic.range.end <= utf16_len)
}

struct Outcome {
    editor: Editor,
    compiler: Compiler,
    staleness_ms: Vec<f64>,
}

/// Runs a session with one coalescing worker on a virtual clock: an action
/// every `interval_ms`, each compile taking its measured time.
fn run_coalescing(engine: &mut Engine, actions: &[Action], interval_ms: f64) -> Outcome {
    let mut editor = Editor::default();
    let mut compiler = Compiler::default();
    let mut staleness_ms = Vec::new();
    // Revision made at each virtual time.
    let mut made_at: Vec<f64> = vec![0.0];
    let mut now;
    let mut worker_free_at = 0.0;
    let mut in_flight: Option<(u64, f64, Arc<ShaperFontCompilation>)> = None;
    let mut next_action = 0;
    loop {
        let next_action_at = (next_action < actions.len()).then(|| (next_action + 1) as f64 * interval_ms);
        let finish_at = in_flight.as_ref().map(|(_, at, _)| *at);
        match (next_action_at, finish_at) {
            (Some(action_at), finish) if finish.is_none_or(|finish| action_at < finish) => {
                now = action_at;
                let before = engine.revisions.len();
                apply(engine, &actions[next_action]);
                next_action += 1;
                for _ in before..engine.revisions.len() {
                    made_at.push(now);
                }
            }
            (_, Some(finish)) => {
                now = finish;
                let (revision, _, compilation) = in_flight.take().unwrap();
                assert!(diagnostics_fit(&engine.revisions[revision as usize], &compilation.diagnostics));
                editor.receive(revision, &compilation);
                staleness_ms.push(now - made_at[revision as usize]);
                worker_free_at = now;
            }
            (None, None) => break,
            _ => unreachable!(),
        }
        // The worker takes only the newest revision it has not compiled.
        if in_flight.is_none() {
            let latest = engine.latest();
            if editor.accepted != Some(latest) {
                let (compilation, ms) = compiler.compile(&engine.revisions[latest as usize]);
                in_flight = Some((latest, worker_free_at.max(now) + ms, compilation));
            }
        }
    }
    Outcome { editor, compiler, staleness_ms }
}

fn assert_final(engine: &Engine, outcome: &Outcome, lines: &[&str]) {
    assert_eq!(outcome.editor.accepted, Some(engine.latest()), "drained to the latest revision");
    let final_compilation = ShaperFont::compile(&engine.revisions[engine.latest() as usize].request).unwrap();
    let (diagnostics_revision, diagnostics) = outcome.editor.diagnostics.as_ref().unwrap();
    assert_eq!(*diagnostics_revision, engine.latest());
    assert_eq!(diagnostics, &final_compilation.diagnostics);
    if final_compilation.font.is_none() && outcome.compiler.fallbacks > 0 && outcome.editor.font.as_ref().is_some_and(|(revision, _)| *revision == 0) {
        // Feature code never compiled: shaping uses the featureless fallback.
        eprintln!("  never compiled: {}", final_compilation.diagnostics.first().map_or("", |d| d.message.as_str()));
        return;
    }
    match &final_compilation.font {
        Some(font) => {
            let (_, editor_font) = outcome.editor.font.as_ref().unwrap();
            assert_eq!(editor_font.bytes(), font.bytes(), "final shaper font");
            assert_eq!(shape(&engine.font, editor_font, lines), shape(&engine.font, font, lines));
        }
        // Errors keep the last valid font, from an earlier revision.
        None => assert!(outcome.editor.font.as_ref().unwrap().0 < engine.latest()),
    }
}

const RULE: &str = "feature ss19 { sub A by B; sub B by A; } ss19;";

#[test]
fn coalesced_native_compiles_converge_on_the_engines_final_feature_code() {
    for path in REAL_FONTS {
        let (font, _dir) = open_path(Path::new(path));
        let base = font.features().fea_source().unwrap_or_default().to_string();
        let mut engine = Engine::new(font);
        let actions = typing_session(&base, RULE);
        // An edit every 120 ms: fast typing, debounced into steps of a few characters.
        let outcome = run_coalescing(&mut engine, &actions, 120.0);
        assert_final(&engine, &outcome, &["AB", "BA", "AAB", "office"]);
        let base_compile = ShaperFont::compile(&engine.revisions[0].request).unwrap();
        eprintln!(
            "  base feature code compiles: {} ({} diagnostics{})",
            base_compile.font.is_some(),
            base_compile.diagnostics.len(),
            base_compile.diagnostics.first().map(|d| format!(", first: {}", d.message)).unwrap_or_default()
        );
        let mut stale = outcome.staleness_ms.clone();
        stale.sort_by(f64::total_cmp);
        let mut compiles = outcome.compiler.compiles.clone();
        compiles.sort_by(f64::total_cmp);
        eprintln!(
            "{}: {} KB feature code; {} actions -> {} revisions; {} compiles (median {:.1} ms, max {:.1} ms), {} cache hits; revision made -> accepted median {:.0} ms, max {:.0} ms; {} stale dropped",
            Path::new(path).file_name().unwrap().to_string_lossy(),
            base.len() / 1024,
            actions.len(),
            engine.revisions.len(),
            compiles.len(),
            compiles[compiles.len() / 2],
            compiles.last().unwrap(),
            outcome.compiler.hits,
            stale[stale.len() / 2],
            stale.last().unwrap(),
            outcome.editor.stale_dropped,
        );
    }
}

#[test]
fn results_delivered_in_any_order_never_replace_newer_ones() {
    let (font, _dir) = open_path(Path::new(REAL_FONTS[0]));
    let base = font.features().fea_source().unwrap_or_default().to_string();
    for seed in 1..=20u64 {
        let mut engine = Engine::new(font.clone());
        for action in typing_session(&base, RULE) {
            apply(&mut engine, &action);
        }
        let mut compiler = Compiler::default();
        let results: Vec<(u64, Arc<ShaperFontCompilation>)> = (0..engine.revisions.len())
            .map(|revision| (revision as u64, compiler.compile(&engine.revisions[revision]).0))
            .collect();
        // Shuffle delivery order.
        let mut order: Vec<usize> = (0..results.len()).collect();
        let mut state = seed;
        for index in (1..order.len()).rev() {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            order.swap(index, (state >> 33) as usize % (index + 1));
        }
        let mut editor = Editor::default();
        let mut last_accepted = None;
        for index in order {
            let (revision, compilation) = &results[index];
            editor.receive(*revision, compilation);
            assert!(editor.accepted >= last_accepted, "accepted revision went backwards");
            last_accepted = editor.accepted;
            let (diagnostics_revision, diagnostics) = editor.diagnostics.as_ref().unwrap();
            assert!(diagnostics_fit(&engine.revisions[*diagnostics_revision as usize], diagnostics));
        }
        let outcome = Outcome { editor, compiler, staleness_ms: vec![] };
        assert_final(&engine, &outcome, &["AB", "BA"]);
    }
}

#[test]
fn undo_while_a_compile_is_in_flight_ends_on_the_undone_text() {
    let (font, _dir) = open_path(Path::new(REAL_FONTS[0]));
    let base = font.features().fea_source().unwrap_or_default().to_string();
    let mut engine = Engine::new(font);
    // A valid edit, then an undo 5 ms later, well inside one compile.
    let actions = vec![Action::Set(format!("{base}\n{RULE}")), Action::Undo];
    let outcome = run_coalescing(&mut engine, &actions, 5.0);
    assert_final(&engine, &outcome, &["AB", "BA"]);
    assert_eq!(engine.revisions.last().unwrap().source, base);
    eprintln!("undo in flight: {} compiles, {} cache hits", outcome.compiler.compiles.len(), outcome.compiler.hits);
}

#[test]
fn an_erroring_edit_keeps_the_last_valid_font_and_reports_its_own_revision() {
    let (font, _dir) = open_path(Path::new(REAL_FONTS[0]));
    let base = font.features().fea_source().unwrap_or_default().to_string();
    let mut engine = Engine::new(font);
    let actions = vec![
        Action::Set(format!("{base}\n{RULE}")),
        Action::Set(format!("{base}\n{RULE}\nfeature ss20 {{ sub A by nosuchglyph; }} ss20;")),
    ];
    let outcome = run_coalescing(&mut engine, &actions, 500.0);
    let (font_revision, _) = outcome.editor.font.as_ref().unwrap();
    let (diagnostics_revision, diagnostics) = outcome.editor.diagnostics.as_ref().unwrap();
    assert_eq!(*diagnostics_revision, engine.latest());
    assert!(!diagnostics.is_empty());
    assert_eq!(*font_revision, engine.latest() - 1, "still shaping with the last valid revision");
    eprintln!("error kept revision {font_revision}; diagnostics for {diagnostics_revision}: {}", diagnostics[0].message);
}

#[test]
#[ignore = "compiles a generated 50 KB feature file; run with --ignored --release"]
fn compile_time_for_large_feature_code() {
    // A synthetic font: 600 glyphs and ~50 KB of single, ligature, and contextual rules.
    let mut font = Font::new();
    let source = font.default_source_id().unwrap();
    let names: Vec<String> = (0..600).map(|index| format!("g{index:03}")).collect();
    for (index, name) in names.iter().enumerate() {
        let mut glyph = shift_font::Glyph::new(name.as_str());
        glyph.add_unicode(0x4E00 + index as u32);
        glyph.set_layer(shift_font::GlyphLayer::with_width(shift_font::LayerId::new(), source.clone(), 500.0));
        font.insert_glyph(glyph).unwrap();
    }
    let mut fea = String::from("languagesystem DFLT dflt;\n@all = [g000-g599];\n");
    for feature in 0..20 {
        fea.push_str(&format!("feature ss{:02} {{\n", feature + 1));
        for rule in 0..40 {
            let a = (feature * 29 + rule * 7) % 600;
            let b = (a + 1 + rule) % 600;
            fea.push_str(&format!("  sub g{a:03} by g{b:03};\n"));
        }
        fea.push_str(&format!("}} ss{:02};\n", feature + 1));
    }
    fea.push_str("feature liga {\n");
    for rule in 0..400 {
        fea.push_str(&format!("  sub g{:03} g{:03} by g{:03};\n", rule % 600, (rule * 3) % 600, (rule * 5 + 1) % 600));
    }
    fea.push_str("} liga;\nfeature calt {\n");
    for rule in 0..300 {
        fea.push_str(&format!("  sub g{:03}' g{:03} by g{:03};\n", rule % 600, (rule * 11) % 600, (rule * 13 + 2) % 600));
    }
    fea.push_str("} calt;\n");
    font.features_mut().set_fea_source(Some(fea.clone()));
    let request = ShaperFontRequest::from_font(&font).unwrap();
    let mut times: Vec<f64> = (0..5)
        .map(|_| {
            let start = Instant::now();
            let compilation = ShaperFont::compile(&request).unwrap();
            assert!(compilation.font.is_some(), "{:?}", compilation.diagnostics.first());
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    times.sort_by(f64::total_cmp);
    eprintln!("synthetic: {} KB of feature code, compile median {:.1} ms, max {:.1} ms", fea.len() / 1024, times[2], times[4]);
}
