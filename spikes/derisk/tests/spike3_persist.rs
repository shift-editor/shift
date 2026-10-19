//! SPIKE 3b: font-level intents applied in the engine, persisted natively as
//! encoded changesets, with no native history.
//!
//! Per trial: a lazy native workspace; an engine opened from a serialized
//! snapshot of its directory-form font (as IPC would deliver it); and a
//! fully loaded reference font applying the same intents with shift-font
//! alone. Each engine edit is encoded (MessagePack, named), decoded, and
//! persisted with `FontWorkspace::persist_change_set`. Checks:
//!  (i)   engine changes == reference changes, and engine font == native font;
//!  (ii)  the store reopened from disk, fully loaded, == the reference;
//!  (iii) undoing every edit in the engine and persisting the inverses the
//!        same way restores the original on disk.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use engine_derisk::engine::{Engine, LoadPolicy};
use engine_derisk::fixtures::{fixture, Document};
use shift_font::test_support::sample_font;
use shift_font::{
    AnchorId, AnchorSeed, Axis, AxisId, DesignLocation, ExternalLocation, Font, FontChangeSet,
    FontIntent, FontIntentSet, GlyphId, GlyphName, KerningGroupId, KerningPair, KerningPosition,
    KerningSide, KerningValueEdit, LayerId, NamedInstance, PointId, SourceId,
};
use shift_store::{ShiftStore, WorkspaceState};
use shift_workspace::FontWorkspace;
use tempfile::TempDir;

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// Where a trial's native workspace lives, so it can be reopened from disk.
enum Backing {
    Store(PathBuf),
    Document { document: PathBuf, recovery: PathBuf },
}

impl Backing {
    fn open(&self) -> FontWorkspace {
        match self {
            Self::Store(path) => FontWorkspace::resume(path).unwrap(),
            Self::Document { document, recovery } => FontWorkspace::open_document(document, recovery).unwrap(),
        }
    }
}

/// Copies of one font's backing: one per workspace that must not share state.
enum Origin {
    Store(PathBuf, TempDir),
    Document(Document),
}

impl Origin {
    fn store(font: &Font) -> Self {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("origin.sqlite");
        let mut store = ShiftStore::open(&path).unwrap();
        store.replace_font_state(font).unwrap();
        store.set_workspace_state(WorkspaceState::untitled(None)).unwrap();
        drop(store);
        Self::Store(path, dir)
    }

    fn copy(&self, into: &Path) -> Backing {
        match self {
            Self::Store(path, _) => {
                let target = into.join("copy.sqlite");
                std::fs::copy(path, &target).unwrap();
                Backing::Store(target)
            }
            Self::Document(document) => {
                let target = into.join("copy.shift");
                std::fs::copy(&document.path, &target).unwrap();
                Backing::Document { document: target, recovery: into.join("recovery.sqlite") }
            }
        }
    }

    fn full_font(&self) -> Font {
        let dir = TempDir::new().unwrap();
        let mut workspace = self.copy(dir.path()).open();
        workspace.acquire_all_layers().unwrap();
        workspace.font().clone()
    }
}

fn encode(changes: &FontChangeSet) -> Vec<u8> {
    rmp_serde::to_vec_named(changes).unwrap()
}

fn decode(bytes: &[u8]) -> FontChangeSet {
    rmp_serde::from_slice(bytes).unwrap()
}

/// A random edit, mostly font-level, against the engine's current font.
fn random_intents(engine: &Engine, visible: &[GlyphId], rng: &mut Lcg, serial: &mut u32) -> (&'static str, Vec<FontIntent>) {
    let font = &engine.font;
    *serial += 1;
    let n = *serial;
    let glyphs: Vec<GlyphId> = font.glyphs().map(|g| g.id()).collect();
    let sources: Vec<SourceId> = font.sources().iter().map(|s| s.id()).collect();
    let any_glyph = |rng: &mut Lcg| glyphs[rng.below(glyphs.len())].clone();
    let any_source = |rng: &mut Lcg| sources[rng.below(sources.len())].clone();
    match rng.below(15) {
        0 => {
            let glyph_id = GlyphId::from_raw(format!("spike{n}"));
            let mut intents = vec![FontIntent::CreateGlyph { glyph_id: Some(glyph_id.clone()), name: format!("spike{n}"), unicodes: vec![0xE000 + n] }];
            for source_id in &sources {
                intents.push(FontIntent::CreateGlyphLayer { layer_id: LayerId::from_raw(format!("spike{n}_{source_id}")), glyph_id: glyph_id.clone(), source_id: source_id.clone() });
            }
            ("createGlyph+layers", intents)
        }
        1 => ("updateGlyph", vec![FontIntent::UpdateGlyph { glyph_id: any_glyph(rng), new_name: GlyphName::new(format!("renamed{n}")).unwrap(), new_unicodes: vec![0xF000 + n] }]),
        2 => {
            let mut location = DesignLocation::new();
            if let Some(axis) = font.axes().first() {
                location.set(axis.id(), axis.minimum() + (axis.maximum() - axis.minimum()) * (rng.below(97) as f64 / 97.0));
            }
            ("createSource", vec![FontIntent::CreateSource { source_id: SourceId::from_raw(format!("spike{n}")), name: format!("Source {n}"), location }])
        }
        3 => {
            let source = font.source(&any_source(rng)).unwrap().clone();
            ("updateSource", vec![FontIntent::UpdateSource {
                source_id: source.id(),
                name: format!("Renamed {n}"),
                location: source.location().clone(),
                metric_values: source.metric_values().clone(),
                italic_angle: source.italic_angle(),
                line_gap: source.line_gap(),
                underline_position: Some(-100.0 - n as f64),
                underline_thickness: source.underline_thickness(),
            }])
        }
        4 => ("deleteSource", vec![FontIntent::DeleteSource { source_id: any_source(rng) }]),
        5 => ("createAxis", vec![FontIntent::CreateAxis { axis: Axis::with_id(AxisId::from_raw(format!("spike{n}")), format!("X{:03}", n % 1000), format!("Spike {n}"), 0.0, 0.0, 1000.0) }]),
        6 => match font.axes().get(rng.below(font.axes().len().max(1))) {
            Some(axis) => {
                let mut axis = axis.clone();
                axis.set_name(format!("Axis renamed {n}"));
                ("updateAxis", vec![FontIntent::UpdateAxis { axis }])
            }
            None => ("noop", vec![]),
        },
        7 => {
            let edits = (0..1 + rng.below(40))
                .map(|_| KerningValueEdit {
                    source_id: any_source(rng),
                    pair: KerningPair::glyphs(any_glyph(rng), any_glyph(rng)),
                    value: if rng.below(5) == 0 { None } else { Some(-(rng.below(120) as f64)) },
                })
                .collect();
            ("setKerningValues", vec![FontIntent::SetKerningValues { edits }])
        }
        8 => {
            let group_id = KerningGroupId::from_raw(format!("spike{n}"));
            let position = if rng.below(2) == 0 { KerningPosition::First } else { KerningPosition::Second };
            let member = any_glyph(rng);
            let partner = any_glyph(rng);
            let pair = match position {
                KerningPosition::First => KerningPair::new(KerningSide::Group(group_id.clone()), KerningSide::Glyph(partner)),
                KerningPosition::Second => KerningPair::new(KerningSide::Glyph(partner), KerningSide::Group(group_id.clone())),
            };
            ("kerningGroup create+member+value", vec![
                FontIntent::CreateKerningGroup { group_id: group_id.clone(), position, name: format!("group{n}") },
                FontIntent::SetKerningGroupMember { position, glyph_id: member, group_id: Some(group_id) },
                FontIntent::SetKerningValues { edits: vec![KerningValueEdit { source_id: any_source(rng), pair, value: Some(-33.0) }] },
            ])
        }
        9 => {
            let groups: Vec<KerningGroupId> = font.kerning().all_groups().map(|(id, _)| id.clone()).collect();
            match groups.get(rng.below(groups.len().max(1))) {
                Some(group_id) if rng.below(2) == 0 => ("renameKerningGroup", vec![FontIntent::RenameKerningGroup { group_id: group_id.clone(), name: format!("renamed{n}") }]),
                Some(group_id) => ("deleteKerningGroup", vec![FontIntent::DeleteKerningGroup { group_id: group_id.clone() }]),
                None => ("noop", vec![]),
            }
        }
        10 => ("setFeatureSource", vec![FontIntent::SetFeatureSource { source: if rng.below(4) == 0 { None } else { Some(format!("feature liga {{ # edit {n}\n}} liga;\n")) } }]),
        11 => {
            let mut metadata = font.metadata().clone();
            metadata.family_name = Some(format!("Family {n}"));
            ("updateFontMetadata", vec![FontIntent::UpdateFontMetadata { metadata }])
        }
        12 => {
            if rng.below(2) == 0 || font.named_instances().is_empty() {
                ("createNamedInstance", vec![FontIntent::CreateNamedInstance { instance: NamedInstance::new(format!("Instance {n}"), ExternalLocation::new(), None) }])
            } else {
                let id = font.named_instances()[rng.below(font.named_instances().len())].id();
                ("deleteNamedInstance", vec![FontIntent::DeleteNamedInstance { instance_id: id }])
            }
        }
        _ => {
            // A layer edit on a visible glyph, interleaved with the font-level ones.
            let glyph = &visible[rng.below(visible.len())];
            let Some(layer) = font.glyph(glyph).and_then(|g| g.layers().values().next().cloned()) else { return ("noop", vec![]) };
            let points: Vec<PointId> = layer.contours_iter().flat_map(|c| c.points().iter().map(|p| p.id())).collect();
            if let Some(point) = points.get(rng.below(points.len())) {
                ("movePoints", vec![FontIntent::MovePoints { layer_id: layer.id(), point_ids: vec![point.clone()], coords: vec![rng.below(500) as f64, rng.below(700) as f64] }])
            } else {
                ("addAnchors", vec![FontIntent::AddAnchors { layer_id: layer.id(), anchors: vec![AnchorSeed { id: AnchorId::from_raw(format!("spike{n}")), name: Some("top".into()), x: 10.0, y: 700.0 }] }])
            }
        }
    }
}

#[derive(Default, Debug)]
struct Tally {
    edits: usize,
    both_rejected: usize,
    by_kind: BTreeMap<&'static str, usize>,
    engine_reference_mismatch: usize,
    mismatch_by_kind: BTreeMap<&'static str, usize>,
    undo_rejected: Vec<String>,
    engine_native_mismatch: usize,
    native_rejected: Vec<String>,
    bytes: usize,
    disk_ok: usize,
    undo_disk_ok: usize,
    trials: usize,
}

fn run(origin: &Origin, trials: u64, steps: usize) -> Tally {
    let mut tally = Tally::default();
    let original = origin.full_font();
    for seed in 1..=trials {
        tally.trials += 1;
        let mut rng = Lcg(seed * 104_729);
        let dir = TempDir::new().unwrap();
        let backing = origin.copy(dir.path());
        let mut native = backing.open();
        let mut reference = original.clone();

        let mut engine = Engine::open(&native, LoadPolicy::RequiredLoads);
        // The engine's snapshot arrives serialized, as IPC would deliver it.
        let snapshot = rmp_serde::to_vec_named(native.font()).unwrap();
        engine.font = rmp_serde::from_slice(&snapshot).unwrap();
        assert!(engine.font == *native.font(), "snapshot round trip");
        if seed == 1 {
            eprintln!("SNAPSHOT directory-form font: {} glyphs, {} bytes (MessagePack, named)", engine.font.glyph_count(), snapshot.len());
        }

        let glyphs: Vec<GlyphId> = engine.font.glyphs().map(|g| g.id()).collect();
        let visible: Vec<GlyphId> = glyphs.iter().filter(|_| rng.below(4) == 0).cloned().collect();
        let visible = if visible.is_empty() { glyphs[..1].to_vec() } else { visible };
        engine.load(&mut native, visible.clone());

        let mut serial = seed as u32 * 1000;
        let mut history: Vec<FontChangeSet> = Vec::new();
        let mut history_kinds: Vec<&'static str> = Vec::new();
        for _ in 0..steps {
            let (kind, intents) = random_intents(&engine, &visible, &mut rng, &mut serial);
            if intents.is_empty() {
                continue;
            }
            let engine_result = engine.apply(&mut native, &intents);
            let reference_result = reference.apply_intents(FontIntentSet { intents: intents.clone() });
            match (engine_result, reference_result) {
                (Ok(applied), Ok(reference_applied)) => {
                    tally.edits += 1;
                    *tally.by_kind.entry(kind).or_default() += 1;
                    let (mine, theirs) = (format!("{:?}", applied.changes), format!("{:?}", reference_applied.changes));
                    if applied.changes != reference_applied.changes {
                        tally.engine_reference_mismatch += 1;
                        *tally.mismatch_by_kind.entry(kind).or_default() += 1;
                        let dump = std::env::temp_dir().join(format!("spike3_{kind}.txt"));
                        if !dump.exists() {
                            std::fs::write(&dump, format!("ENGINE\n{mine}\nREFERENCE\n{theirs}\n")).unwrap();
                        }
                    }
                    let bytes = encode(&applied.changes);
                    tally.bytes += bytes.len();
                    if let Err(error) = native.persist_change_set(decode(&bytes), true) {
                        tally.native_rejected.push(format!("{kind}: {error}"));
                        continue;
                    }
                    if engine.font != *native.font() {
                        tally.engine_native_mismatch += 1;
                    }
                    history.push(applied.changes);
                    history_kinds.push(kind);
                }
                (Err(_), Err(_)) => tally.both_rejected += 1,
                (engine_result, reference_result) => {
                    tally.engine_reference_mismatch += 1;
                    eprintln!("MISMATCH {kind}: engine ok={} reference ok={}", engine_result.is_ok(), reference_result.is_ok());
                }
            }
        }
        assert!(native.is_dirty().unwrap() || history.is_empty());
        drop(native);

        // (ii) Disk holds exactly what the engine computed.
        let mut reopened = backing.open();
        reopened.acquire_all_layers().unwrap();
        #[allow(unused_assignments)]
        if *reopened.font() == reference {
            tally.disk_ok += 1;
        }
        if std::env::var("DOUBLE_REOPEN").is_ok() {
            drop(reopened);
            let mut again = backing.open();
            again.acquire_all_layers().unwrap();
            eprintln!("REOPEN2 seed={seed} equal={}", *again.font() == reference);
            reopened = again;
        }

        // (iii) Undo everything in the engine; persist the inverses the same way.
        let mut native = {
            drop(reopened);
            backing.open()
        };
        if std::env::var("COMPARE_LOADS").is_ok() {
            let full = {
                let mut w = backing.open();
                w.acquire_all_layers().unwrap();
                w.font().clone()
            };
            let touched: std::collections::BTreeSet<LayerId> = history.iter().flat_map(|c| c.changes.iter().filter_map(|c| c.layer_id())).collect();
            let mut probe = backing.open();
            for layer_id in &touched {
                let Some(glyph_id) = probe.font().glyph_id_by_layer(layer_id) else { continue };
                probe.acquire_glyphs(&[glyph_id.clone()], shift_workspace::AcquireScope::Glyphs).unwrap();
                if probe.font().layer(layer_id) != full.layer(layer_id) {
                    eprintln!("LOADDIFF seed={seed} layer={layer_id} glyph={} targeted_anchors={:?} full_anchors={:?}", probe.font().glyph(&glyph_id).unwrap().glyph_name(),
                        probe.font().layer(layer_id).map(|l| l.anchors().len()), full.layer(layer_id).map(|l| l.anchors().len()));
                }
            }
        }
        if std::env::var("ACQUIRE_ALL").is_ok() {
            native.acquire_all_layers().unwrap();
        }
        let mut undo_failed = false;
        for (index, changes) in history.iter().enumerate().rev() {
            let inverse = changes.inverted();
            engine.font.apply_change_set(&inverse).unwrap();
            if std::env::var("UNDO_STEPS").is_ok() {
                let summary: Vec<String> = inverse.changes.iter().map(|c| {
                    let variant = format!("{c:?}"); let variant = variant.split(|ch: char| !ch.is_alphanumeric()).next().unwrap_or("").to_string();
                    format!("{variant}:{}", c.glyph_id().map(|g| native.font().glyph(&g).map(|g| g.glyph_name().to_string()).unwrap_or(g.to_string())).unwrap_or_default())
                }).collect();
                eprintln!("STEP seed={seed} undo #{index} {} {:?}", history_kinds[index], summary);
            }
            // Dirty until the last inverse returns to the opened (saved) state. In a
            // document, `dirty: false` tells the store the overlay can be discarded.
            let persisted = native.persist_change_set(decode(&encode(&inverse)), index != 0);
            if persisted.is_ok() && std::env::var("UNDO_TRACE").is_ok() {
                let differing: Vec<String> = engine.font.glyphs().filter(|g| {
                    let theirs = native.font().glyph(&g.id());
                    // compare only layers resident on both sides
                    theirs.is_some_and(|t| g.layers().iter().any(|(id, l)| t.layers().get(id).is_some_and(|tl| !tl.contours().is_empty() || !tl.anchors().is_empty() || !tl.components().is_empty()) && t.layers().get(id).map(|tl| tl.as_ref()) != Some(l.as_ref())))
                }).map(|g| g.glyph_name().to_string()).collect();
                if !differing.is_empty() {
                    eprintln!("UNDODIFF seed={seed} after undoing #{index} {}: {:?}", history_kinds[index], &differing[..differing.len().min(5)]);
                }
            }
            if let Err(error) = persisted {
                let kinds: Vec<String> = inverse.changes.iter().map(|c| format!("{:?}", std::mem::discriminant(c))).collect();
                tally.undo_rejected.push(format!("{error} ({} changes)", kinds.len()));
                let failing_layers: Vec<LayerId> = inverse.changes.iter().filter_map(|c| c.layer_id()).collect();
                let mut detail = format!("failed undoing #{index} {} entity_changes={}\n", history_kinds[index], inverse.entity_changes().len());
                for change in &inverse.changes {
                    if let shift_font::FontChange::Layer { glyph_id, layer, .. } = change {
                        detail += &format!("glyph {glyph_id} before==after: {} glyph in native: {}\n", layer.before == layer.after, native.font().glyph(glyph_id).map(|g| g.glyph_name().to_string()).unwrap_or_default());
                    }
                }
                for (i, earlier) in history.iter().enumerate() {
                    let touches = earlier.changes.iter().any(|c| c.layer_id().is_some_and(|l| failing_layers.contains(&l))
                        || matches!(c, shift_font::FontChange::Glyph(g) if g.before.iter().chain(g.after.iter()).any(|g| g.layers().keys().any(|l| failing_layers.contains(l)))));
                    if touches { detail += &format!("  touched by #{i} {}\n", history_kinds[i]); }
                }
                for change in &inverse.changes {
                    if let shift_font::FontChange::Layer { layer, .. } = change {
                        if let Some(expected) = &layer.before {
                            let current = native.font().layer(&expected.id());
                            detail += &format!("EXPECTED {expected:#?}\nCURRENT {current:#?}\n");
                        }
                    }
                }
                std::fs::write("/tmp/claude-1000/spike3_undo.txt", detail).unwrap();
                undo_failed = true;
                break;
            }
        }
        if undo_failed {
            continue;
        }
        drop(native);
        let mut reopened = backing.open();
        reopened.acquire_all_layers().unwrap();
        if *reopened.font() == original {
            tally.undo_disk_ok += 1;
        }
    }
    tally
}

#[test]
fn font_level_intents_persist_as_changesets() {
    let origins = [
        ("sample_font", Origin::store(&sample_font())),
        ("Homenaje", Origin::Document(Document::import(&fixture("Homenaje.glyphs")))),
    ];
    let mut failures = 0;
    for (name, origin) in &origins {
        let tally = run(origin, 25, 40);
        eprintln!("PERSIST {name}: {tally:#?}");
        failures += tally.engine_reference_mismatch + tally.engine_native_mismatch + tally.native_rejected.len()
            + (tally.trials - tally.disk_ok)
            + (tally.trials - tally.undo_disk_ok)
            + tally.undo_rejected.len();
    }
    assert_eq!(failures, 0);
}
