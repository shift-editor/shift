//! Spike 11: font-level files through sync-in (sources, axes, kerning, groups,
//! features, glyph order, renames) and what undoing a pull means.
//!
//! `cargo test --release --test spike11_font_level -- --nocapture --test-threads=1`

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use engine_derisk::text_folder::{all_json, file_name, font_files, glyph_text, FolderSync};
use shift_font::{Contour, FontChange, FontChangeSet, Glyph, GlyphId, GlyphLayer, LayerId, Replacement, SourceId};
use shift_workspace::FontWorkspace;

const MUTATOR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");

struct Fixture {
    workspace: FontWorkspace,
    sync: FolderSync,
    _store: tempfile::TempDir,
    _folder: tempfile::TempDir,
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").args(["-c", "user.email=s@s", "-c", "user.name=s"]).args(args).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}

/// Opens MutatorSans (with feature code, so renames have something to break),
/// writes the whole folder and commits it on `main`.
fn open() -> Fixture {
    let store = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(MUTATOR, store.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    let before = workspace.font().features().fea_source().map(str::to_string);
    let fea = "feature ss01 {\n    sub A by B;\n} ss01;\n".to_string();
    workspace.persist_change_set(FontChangeSet::new(vec![FontChange::FeatureSource(Replacement { before, after: Some(fea) })]), false).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let mut sync = FolderSync::new(folder.path());
    let glyphs: Vec<&Glyph> = workspace.font().glyphs().collect();
    sync.write(&glyphs);
    sync.write_font_files(workspace.font());
    git(folder.path(), &["init", "-q", "-b", "main"]);
    git(folder.path(), &["add", "-A"]);
    git(folder.path(), &["commit", "-qm", "main"]);
    Fixture { workspace, sync, _store: store, _folder: folder }
}

fn glyph_id(fixture: &Fixture, name: &str) -> GlyphId {
    fixture.workspace.font().glyphs().find(|g| g.name() == name).unwrap().id()
}

fn edit_json(path: &Path, edit: impl FnOnce(&mut serde_json::Value)) {
    let mut value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    edit(&mut value);
    let mut text = serde_json::to_string_pretty(&value).unwrap();
    text.push('\n');
    std::fs::write(path, text).unwrap();
}

/// Plans and applies everything that differs from what Shift knows.
fn pull(fixture: &mut Fixture) -> (engine_derisk::text_folder::SyncInReport, engine_derisk::text_folder::FontLevelReport, Result<FontChangeSet, String>) {
    let paths: HashSet<PathBuf> = all_json(&fixture.sync.dir);
    let (change_set, glyphs, font_level, accepted) = fixture.sync.plan_pull(&paths, fixture.workspace.font());
    let applied = change_set.clone();
    let outcome = fixture.workspace.persist_change_set(change_set, false).map(|_| applied).map_err(|e| format!("{e:?}"));
    if outcome.is_ok() {
        fixture.sync.accept(accepted);
    }
    (glyphs, font_level, outcome)
}

/// The font-level files Shift would write now equal the files on disk: as
/// text, or as JSON values when another tool reformatted the file.
fn assert_font_files_match_disk(fixture: &Fixture) {
    for (rel, text) in font_files(fixture.workspace.font()) {
        let disk = std::fs::read_to_string(fixture.sync.dir.join(&rel)).unwrap_or_default();
        if text == disk {
            continue;
        }
        if rel.ends_with(".txt") && rel.starts_with("kerning/") {
            let parse = |t: &str| t.lines().map(|l| { let (pair, v) = l.rsplit_once('\t').unwrap(); (pair.to_string(), v.parse::<f64>().unwrap()) }).collect::<std::collections::BTreeMap<_, _>>();
            if parse(&text) == parse(&disk) {
                continue;
            }
        }
        if rel.ends_with(".json") {
            let (a, b): (serde_json::Value, serde_json::Value) = (serde_json::from_str(&text).unwrap(), serde_json::from_str(&disk).unwrap());
            if a == b {
                continue;
            }
        }
        let line = text.lines().zip(disk.lines()).position(|(a, b)| a != b).unwrap_or(0);
        panic!("{rel} differs at line {line}: shift `{}` vs disk `{}`", text.lines().nth(line).unwrap_or(""), disk.lines().nth(line).unwrap_or(""));
    }
}

#[test]
fn font_level_files_round_trip_exactly() {
    let mut fixture = open();
    // Forget every font-level hash: the whole set is re-read and applied.
    fixture.sync.last_known.retain(|k, _| !k.contains('/'));
    let (_, report, outcome) = pull(&mut fixture);
    eprintln!("re-read {} font-level files", report.changed_files.len());
    outcome.unwrap();
    assert!(report.unsupported.is_empty() && report.dangling_kerning.is_empty());
    assert_font_files_match_disk(&fixture);
}

/// A teammate adds a master: a new source in sources.json and layers for it
/// in three glyph files, in one commit.
#[test]
fn pull_that_adds_a_master_needs_post_pull_validation() {
    let mut fixture = open();
    let dir = fixture.sync.dir.clone();
    let template = fixture.workspace.font().sources().iter().find(|s| Some(s.id()) != fixture.workspace.font().default_source_id()).unwrap().id();
    let new_source = "source_teammate_master";
    edit_json(&dir.join("font/sources.json"), |v| {
        let sources = v["sources"].as_array_mut().unwrap();
        let mut copy = sources.iter().find(|s| s["id"] == template.to_string()).unwrap().clone();
        copy["id"] = new_source.into();
        copy["name"] = "Teammate Master".into();
        sources.push(copy);
    });
    let names = ["A", "B", "C"];
    for name in names {
        let mut glyph = fixture.workspace.font().glyph(&glyph_id(&fixture, name)).unwrap().clone();
        let base = glyph.layers().values().find(|l| l.source_id() == template).unwrap().clone();
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("layer_new_{name}")), SourceId::from_raw(new_source), base.width());
        for contour in base.contours_iter() {
            let mut fresh = Contour::new();
            for point in contour.points() {
                fresh.add_point(point.x(), point.y(), point.point_type(), point.is_smooth());
            }
            if contour.is_closed() {
                fresh.close();
            }
            layer.add_contour(fresh);
        }
        glyph.set_layer(layer);
        std::fs::write(dir.join(file_name(&glyph.id())), glyph_text(&glyph)).unwrap();
    }

    // Validating glyph files against the pre-pull sources rejects them.
    let (_, naive, _) = fixture.sync.plan(&all_json(&dir), fixture.workspace.font());
    eprintln!("pre-pull validation: {} glyph files invalid ({:?})", naive.invalid.len(), naive.invalid.first().map(|(_, e)| e));

    let (glyphs, report, outcome) = pull(&mut fixture);
    eprintln!("post-pull validation: files {:?}, invalid {}, engine {:?}", report.changed_files, glyphs.invalid.len(), outcome.as_ref().err());
    outcome.unwrap();
    assert!(glyphs.invalid.is_empty());
    assert!(fixture.workspace.font().source(&SourceId::from_raw(new_source)).is_some());
    assert_font_files_match_disk(&fixture);
}

#[test]
fn kerning_and_group_edits_apply_pair_by_pair() {
    let mut fixture = open();
    let dir = fixture.sync.dir.clone();
    let default = fixture.workspace.font().default_source_id().unwrap();
    let kerning_path = dir.join(format!("kerning/{default}.txt"));
    let text = std::fs::read_to_string(&kerning_path).unwrap();
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let before_pairs = lines.len();
    let changed = lines[0].rsplit_once('\t').map(|(pair, _)| format!("{pair}\t-77")).unwrap();
    lines[0] = changed;
    lines.remove(1);
    lines.push(format!("{}\t{}\t-5", glyph_id(&fixture, "H"), glyph_id(&fixture, "O")));
    std::fs::write(&kerning_path, lines.join("\n") + "\n").unwrap();
    let mut group_edit = String::new();
    let extra = glyph_id(&fixture, "Q").to_string();
    edit_json(&dir.join("font/kerning-groups.json"), |v| {
        if let Some((id, group)) = v.as_object_mut().unwrap().iter_mut().next() {
            group["members"].as_array_mut().unwrap().push(extra.clone().into());
            group_edit = format!("{id}: added Q");
        }
    });

    let (_, report, outcome) = pull(&mut fixture);
    let applied = outcome.unwrap();
    eprintln!("kerning pull: {before_pairs} pairs in the file, {} changes applied ({group_edit}); files {:?}", applied.changes.len(), report.changed_files);
    assert!(applied.changes.iter().any(|c| matches!(c, FontChange::KerningGroup { .. })), "the group change applied");
    assert_font_files_match_disk(&fixture);
}

#[test]
fn kerning_that_names_a_missing_glyph_is_reported() {
    let mut fixture = open();
    let dir = fixture.sync.dir.clone();
    let default = fixture.workspace.font().default_source_id().unwrap();
    let path = dir.join(format!("kerning/{default}.txt"));
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str(&format!("glyph_ghost\t{}\t-20\n", glyph_id(&fixture, "O")));
    std::fs::write(&path, text).unwrap();
    let (_, report, outcome) = pull(&mut fixture);
    eprintln!("dangling kerning: {:?}; engine accepted it anyway: {}", report.dangling_kerning, outcome.is_ok());
    assert_eq!(report.dangling_kerning.len(), 1);
}

#[test]
fn rename_on_disk_leaves_feature_code_and_component_names_stale() {
    let mut fixture = open();
    let dir = fixture.sync.dir.clone();
    let a = glyph_id(&fixture, "A");
    edit_json(&dir.join(file_name(&a)), |v| v["name"] = "A.alt".into());
    // edit_json re-formats the file; Shift normalizes it on its next save.
    let (_, report, outcome) = pull(&mut fixture);
    outcome.unwrap();
    eprintln!("stale feature names: {:?}", report.stale_feature_names);
    assert_eq!(report.stale_feature_names, vec!["A".to_string()]);

    let font = fixture.workspace.font();
    let stale_components: Vec<String> = font
        .glyphs()
        .flat_map(|g| g.layers().values().flat_map(move |l| l.components_iter().map(move |c| (g.name().to_string(), c.base_glyph_id(), c.base_glyph_name().to_string()))).collect::<Vec<_>>())
        .filter(|(_, base, cached)| font.glyph(base).is_some_and(|b| b.name() != cached))
        .map(|(owner, _, cached)| format!("{owner} -> {cached}"))
        .collect();
    eprintln!("components still caching the old base name: {} (e.g. {:?})", stale_components.len(), stale_components.first());
}

#[test]
fn reordering_glyphs_is_unsupported() {
    let mut fixture = open();
    let path = fixture.sync.dir.join("font/glyph-order.txt");
    let mut lines: Vec<String> = std::fs::read_to_string(&path).unwrap().lines().map(str::to_string).collect();
    lines.swap(1, 2);
    std::fs::write(&path, lines.join("\n") + "\n").unwrap();
    let (_, report, _) = pull(&mut fixture);
    eprintln!("unsupported: {:?}", report.unsupported);
    assert_eq!(report.unsupported.len(), 1);
}

#[test]
fn removing_a_source_that_layers_still_use() {
    let mut fixture = open();
    let default = fixture.workspace.font().default_source_id().unwrap();
    let victim = fixture.workspace.font().sources().iter().find(|s| s.id() != default).unwrap().id();
    edit_json(&fixture.sync.dir.join("font/sources.json"), |v| {
        v["sources"].as_array_mut().unwrap().retain(|s| s["id"] != victim.to_string());
    });
    let (_, _, outcome) = pull(&mut fixture);
    let orphaned = fixture.workspace.font().glyphs().flat_map(|g| g.layers().values()).filter(|l| l.source_id() == victim).count();
    eprintln!("engine on removing a source with layers: {:?}; layers still on it: {orphaned}", outcome.as_ref().err());
}

/// 2: undoing a pull. Unsaved means "differs from disk", so undo makes the
/// pulled glyphs unsaved, a later outside change to one of them conflicts,
/// redo makes them clean, and saving after undo is a visible local revert.
#[test]
fn undoing_a_pull_is_a_visible_local_revert() {
    let mut fixture = open();
    let dir = fixture.sync.dir.clone();
    let names = ["B", "C", "D", "E", "F"];
    let ids: Vec<GlyphId> = names.iter().map(|n| glyph_id(&fixture, n)).collect();

    git(&dir, &["checkout", "-qb", "teammate"]);
    for id in &ids {
        let mut glyph = fixture.workspace.font().glyph(id).unwrap().clone();
        let layer_id = glyph.layers().keys().next().unwrap().clone();
        let mut layer = (**glyph.layers().get(&layer_id).unwrap()).clone();
        layer.set_width(layer.width() + 10.0);
        glyph.set_layer(layer);
        std::fs::write(dir.join(file_name(id)), glyph_text(&glyph)).unwrap();
    }
    git(&dir, &["commit", "-qam", "teammate"]);
    git(&dir, &["checkout", "-q", "main"]);
    git(&dir, &["checkout", "-q", "teammate"]);

    let (_, _, outcome) = pull(&mut fixture);
    let applied = outcome.unwrap();
    fixture.sync.refresh_unsaved(fixture.workspace.font(), ids.clone());
    assert!(fixture.sync.unsaved.is_empty(), "after the pull the font matches disk");

    // Undo: the five glyphs now differ from disk, so they're unsaved.
    fixture.workspace.persist_change_set(applied.inverted(), false).unwrap();
    fixture.sync.refresh_unsaved(fixture.workspace.font(), ids.clone());
    let mut unsaved: Vec<_> = fixture.sync.unsaved.iter().cloned().collect();
    unsaved.sort();
    let mut expected = ids.clone();
    expected.sort();
    assert_eq!(unsaved, expected, "undo marks exactly the pulled glyphs unsaved");

    // Redo: back to the disk version, clean again.
    fixture.workspace.persist_change_set(applied.clone(), false).unwrap();
    fixture.sync.refresh_unsaved(fixture.workspace.font(), ids.clone());
    assert!(fixture.sync.unsaved.is_empty(), "redo makes them clean");

    // Undo again, then a script changes B on disk: B conflicts, nothing else moves.
    fixture.workspace.persist_change_set(applied.inverted(), false).unwrap();
    fixture.sync.refresh_unsaved(fixture.workspace.font(), ids.clone());
    edit_json(&dir.join(file_name(&ids[0])), |v| v["name"] = "B.script".into());
    let (glyphs, _, outcome) = pull(&mut fixture);
    outcome.unwrap();
    eprintln!("outside change after undo: conflicts {:?}, updated {:?}", glyphs.conflicts, glyphs.updated);
    assert_eq!(glyphs.conflicts, vec![ids[0].clone()]);
    git(&dir, &["checkout", "-q", "--", "."]);
    fixture.sync.last_known.retain(|_, _| true);

    // Saving after the undo writes the pre-pull versions: Git shows a local
    // revert of the teammate's commit, nothing silent.
    let glyphs: Vec<Glyph> = ids.iter().map(|id| fixture.workspace.font().glyph(id).unwrap().clone()).collect();
    let refs: Vec<&Glyph> = glyphs.iter().collect();
    fixture.sync.write(&refs);
    let status = git(&dir, &["status", "--porcelain"]);
    let modified: Vec<&str> = status.lines().collect();
    eprintln!("git status after saving the undo: {} modified", modified.len());
    assert_eq!(modified.len(), 5);
    let reverted = Command::new("git").args(["diff", "--quiet", "main", "--"]).args(ids.iter().map(file_name)).current_dir(&dir).status().unwrap();
    assert!(reverted.success(), "the working tree equals main for those glyphs: a revert");
}


/// Serializing the engine's own types is not deterministic: a source's location
/// is a HashMap, so the same content can come out in a different key order.
/// The format needs its own document types with sorted maps.
#[test]
fn engine_serde_is_not_deterministic() {
    let fixture = open();
    let text = std::fs::read_to_string(fixture.sync.dir.join("font/sources.json")).unwrap();
    let mut differing = 0;
    for _ in 0..20 {
        let parsed: shift_font::SourceCollection = serde_json::from_str(&text).unwrap();
        let mut again = serde_json::to_string_pretty(&parsed).unwrap();
        again.push('\n');
        if again != text {
            differing += 1;
        }
    }
    eprintln!("sources.json re-serialized 20 times: {differing} came out with a different key order");
    assert!(differing > 0);
}
