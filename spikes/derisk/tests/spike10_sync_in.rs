//! Spike 10: sync in. Outside changes to a `.shift` text folder (git checkout,
//! scripts, teammates) reach the open font through the engine, without a button.
//!
//! Each test drives real Git and a real file watcher against a real
//! `FontWorkspace`, then checks the font against the files on disk.
//!
//! `cargo test --release --test spike10_sync_in -- --nocapture` (add
//! `--ignored` for the 65k-glyph runs).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use engine_derisk::text_folder::{all_json, content_hash, file_name, glyph_text, parse_glyph, FolderSync};
use notify::{RecursiveMode, Watcher};
use shift_font::{FontChange, FontChangeSet, Glyph, GlyphId, Replacement};
use shift_workspace::FontWorkspace;

const MUTATOR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
const ROBOTO_FLEX: &str = "/home/kostyafarber/repos/designspace-stress/roboto-flex/sources/RobotoFlex.designspace";
const NOTO_CJK: &str = "/home/kostyafarber/repos/rumil-core-or-tex/.cache/src/RaTeX/scripts/fonts/NotoSansCJKsc-Regular.otf";

struct Fixture {
    workspace: FontWorkspace,
    sync: FolderSync,
    _store: tempfile::TempDir,
    _folder: tempfile::TempDir,
}

fn spike_root() -> PathBuf {
    std::env::var("SPIKE_DIR").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir())
}

/// Opens a font, writes it as a text folder and commits it on `main`.
fn open(path: &str) -> Fixture {
    let store = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(path, store.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    let folder = tempfile::tempdir_in(spike_root()).unwrap();
    let mut sync = FolderSync::new(folder.path());
    let glyphs: Vec<&Glyph> = workspace.font().glyphs().collect();
    sync.write(&glyphs);
    git(folder.path(), &["init", "-q", "-b", "main"]);
    git(folder.path(), &["add", "-A"]);
    git(folder.path(), &["commit", "-qm", "main"]);
    Fixture { workspace, sync, _store: store, _folder: folder }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "user.email=s@s", "-c", "user.name=s"])
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

struct Watched {
    paths: HashSet<PathBuf>,
    events: usize,
    rescan: bool,
    /// From the end of the action to the end of the quiet period.
    settle: Duration,
}

/// Runs `action` with a watcher on `dir` and collects changed paths until the
/// folder has been quiet for `QUIET`.
fn watch(dir: &Path, action: impl FnOnce()) -> Watched {
    const QUIET: Duration = Duration::from_millis(150);
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx).unwrap();
    watcher.watch(dir, RecursiveMode::NonRecursive).unwrap();
    action();
    let acted = Instant::now();
    let mut watched = Watched { paths: HashSet::new(), events: 0, rescan: false, settle: Duration::ZERO };
    let mut timeout = Duration::from_secs(5);
    while let Ok(result) = rx.recv_timeout(timeout) {
        timeout = QUIET;
        watched.events += 1;
        match result {
            Ok(event) => {
                if event.need_rescan() {
                    watched.rescan = true;
                }
                watched.paths.extend(event.paths.into_iter().filter(|p| p.parent() == Some(dir)));
            }
            Err(_) => watched.rescan = true,
        }
    }
    watched.settle = acted.elapsed();
    watched
}

/// Changed paths from a watch, or every path Shift knows plus every file on
/// disk when the watcher lost events.
fn changed_paths(sync: &FolderSync, watched: &Watched) -> HashSet<PathBuf> {
    if !watched.rescan {
        return watched.paths.clone();
    }
    let mut paths = all_json(&sync.dir);
    paths.extend(sync.last_known.keys().map(|file| sync.dir.join(file)));
    paths
}

/// Applies outside changes through the workspace, as another writer's edits.
fn sync_in(fixture: &mut Fixture, paths: &HashSet<PathBuf>) -> (engine_derisk::text_folder::SyncInReport, FontChangeSet, Duration, Duration) {
    let start = Instant::now();
    let (change_set, report, accepted) = fixture.sync.plan(paths, fixture.workspace.font());
    let plan = start.elapsed();
    let start = Instant::now();
    let applied = change_set.clone();
    if !change_set.changes.is_empty() {
        fixture.workspace.persist_change_set(change_set, false).unwrap();
    }
    fixture.sync.accept(accepted);
    (report, applied, plan, start.elapsed())
}

/// Every glyph file on disk parses to exactly the glyph the font holds, and
/// every font glyph has a file.
fn assert_font_matches_disk(fixture: &Fixture) {
    let font = fixture.workspace.font();
    let known: HashSet<GlyphId> = font.glyphs().map(Glyph::id).collect();
    let files = all_json(&fixture.sync.dir);
    assert_eq!(files.len(), known.len(), "file count vs glyph count");
    for path in files {
        let file = path.file_name().unwrap().to_str().unwrap();
        let id = GlyphId::from_raw(file.trim_end_matches(".json"));
        let current = font.glyph(&id).unwrap_or_else(|| panic!("{file} on disk but not in the font"));
        let parsed = parse_glyph(file, &std::fs::read(&path).unwrap(), font, Some(current), &known).unwrap();
        assert_eq!(&parsed, current, "{file}");
    }
}

/// Text-level edit, as a script or teammate would make it: shift the first
/// advance by `delta`.
fn bump_advance(path: &Path, delta: f64) {
    let text = std::fs::read_to_string(path).unwrap();
    let key = "\"advance\": ";
    let start = text.find(key).unwrap() + key.len();
    let end = start + text[start..].find(',').unwrap();
    let value: f64 = text[start..end].parse().unwrap();
    let edited = format!("{}{}{}", &text[..start], serde_json::to_string(&(value + delta)).unwrap(), &text[end..]);
    std::fs::write(path, edited).unwrap();
}

fn glyph_by_name<'a>(fixture: &'a Fixture, name: &str) -> &'a Glyph {
    fixture.workspace.font().glyphs().find(|g| g.name() == name).unwrap()
}

/// Names the first field where two versions of a glyph differ.
fn first_difference(font: &Glyph, parsed: &Glyph) -> String {
    if font.name() != parsed.name() || font.unicodes() != parsed.unicodes() {
        return "name or unicodes".into();
    }
    if font.lib() != parsed.lib() || font.category() != parsed.category() {
        return "glyph lib or category".into();
    }
    for (id, a) in font.layers() {
        let Some(b) = parsed.layers().get(id) else { return format!("layer {id} missing") };
        let checks = [
            ("width", a.width() == b.width()),
            ("height", a.height() == b.height()),
            ("contours", a.contours() == b.contours()),
            ("components", a.components() == b.components()),
            ("anchors", a.anchors() == b.anchors()),
            ("guidelines", a.guidelines() == b.guidelines()),
            ("lib", a.lib() == b.lib()),
        ];
        if let Some((field, _)) = checks.iter().find(|(_, same)| !same) {
            if *field == "components" {
                let ca: Vec<_> = a.components_iter().map(|c| format!("{:?} {:?}", c.base_glyph_name(), c.transform())).collect();
                let cb: Vec<_> = b.components_iter().map(|c| format!("{:?} {:?}", c.base_glyph_name(), c.transform())).collect();
                return format!("layer {id} components: {ca:?} vs {cb:?}");
            }
            if *field == "guidelines" {
                return format!("layer {id} guidelines: {:?} vs {:?}", a.guidelines(), b.guidelines());
            }
            return format!("layer {id} {field}");
        }
        if **a != **b {
            return format!("layer {id}: other field (e.g. source)");
        }
    }
    "glyph-level field".into()
}

fn ms(d: Duration) -> String {
    format!("{:.1} ms", d.as_secs_f64() * 1000.0)
}

#[test]
fn round_trip_through_files_is_exact() {
    for (label, path) in [("MutatorSans", MUTATOR), ("Roboto Flex", ROBOTO_FLEX)] {
        let fixture = open(path);
        let font = fixture.workspace.font();
        let known: HashSet<GlyphId> = font.glyphs().map(Glyph::id).collect();
        let mut exact = 0;
        let mut differing = Vec::new();
        for glyph in font.glyphs() {
            let text = glyph_text(glyph);
            let parsed = parse_glyph(&file_name(&glyph.id()), text.as_bytes(), font, Some(glyph), &known).unwrap();
            if &parsed == glyph {
                exact += 1;
            } else {
                if differing.len() < 3 {
                    eprintln!("{}: {}", glyph.name(), first_difference(glyph, &parsed));
                }
                differing.push(glyph.name().to_string());
            }
            assert_eq!(glyph_text(&parsed), text, "{label} {}: re-rendered text differs", glyph.name());
        }
        eprintln!("{label}: {exact}/{} glyphs exactly equal after a file round trip; differing: {:?}", known.len(), &differing[..differing.len().min(5)]);
        assert!(differing.is_empty());
    }
}

#[test]
fn branch_switch_updates_the_open_font() {
    let mut fixture = open(MUTATOR);
    let dir = fixture.sync.dir.clone();
    let original: HashMap<GlyphId, String> = fixture.workspace.font().glyphs().map(|g| (g.id(), glyph_text(g))).collect();

    // A teammate's branch: five glyphs edited by hand, one deleted, one added.
    git(&dir, &["checkout", "-qb", "teammate"]);
    let edited: Vec<GlyphId> = ["B", "C", "D", "E", "F"].iter().map(|n| glyph_by_name(&fixture, n).id()).collect();
    for id in &edited {
        bump_advance(&dir.join(file_name(id)), 10.0);
    }
    let template = std::fs::read_to_string(dir.join(file_name(&glyph_by_name(&fixture, "I").id()))).unwrap();
    let old_id = glyph_by_name(&fixture, "I").id().to_string();
    let new_text = template.replace(&old_id, "glyph_I_alt").replace("\"layer_", "\"layer_alt_").replace("\"contour_", "\"contour_alt_").replace("\"point_", "\"point_alt_").replace("\"name\": \"I\"", "\"name\": \"I.alt\"").replace("\"unicodes\": [\"0049\"]", "\"unicodes\": []");
    std::fs::write(dir.join("glyph_I_alt.json"), new_text).unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-qm", "teammate"]);
    git(&dir, &["checkout", "-q", "main"]);
    // Shift's own content is main; re-sync after the checkouts above, which
    // happened before the font was "open".
    let paths = all_json(&dir);
    let (report, _, _, _) = sync_in(&mut fixture, &paths);
    assert!(report.updated.is_empty() && report.added.is_empty() && report.deleted.is_empty());

    // With the font open: switch to the teammate's branch.
    let watched = watch(&dir, || git(&dir, &["checkout", "-q", "teammate"]));
    let paths = changed_paths(&fixture.sync, &watched);
    let (report, applied, plan, apply) = sync_in(&mut fixture, &paths);
    eprintln!(
        "checkout teammate: {} events, {} paths, settle {}, plan {}, apply {}; updated {} added {} deleted {} conflicts {} invalid {} dangling {}",
        watched.events, paths.len(), ms(watched.settle), ms(plan), ms(apply),
        report.updated.len(), report.added.len(), report.deleted.len(), report.conflicts.len(), report.invalid.len(), report.dangling.len()
    );
    assert_eq!(report.updated.len(), 5);
    assert_eq!(report.added, vec![GlyphId::from_raw("glyph_I_alt")]);
    assert!(report.deleted.is_empty() && report.conflicts.is_empty() && report.invalid.is_empty());
    assert_eq!(fixture.workspace.font().glyph(&GlyphId::from_raw("glyph_I_alt")).unwrap().name(), "I.alt");
    assert_font_matches_disk(&fixture);

    // Undo the pull as one step: the inverse change set restores main exactly.
    fixture.workspace.persist_change_set(applied.inverted(), false).unwrap();
    let restored: HashMap<GlyphId, String> = fixture.workspace.font().glyphs().map(|g| (g.id(), glyph_text(g))).collect();
    assert_eq!(restored, original, "undo of the outside change");
    fixture.workspace.persist_change_set(applied, false).unwrap();

    // And back to main through the watcher.
    let watched = watch(&dir, || git(&dir, &["checkout", "-q", "main"]));
    let paths = changed_paths(&fixture.sync, &watched);
    sync_in(&mut fixture, &paths);
    let back: HashMap<GlyphId, String> = fixture.workspace.font().glyphs().map(|g| (g.id(), glyph_text(g))).collect();
    assert_eq!(back, original, "checkout main restores the original font");
    assert_font_matches_disk(&fixture);
}

#[test]
fn own_saves_are_not_reimported() {
    let mut fixture = open(MUTATOR);
    let dir = fixture.sync.dir.clone();
    // Ten local edits, then Cmd+S writes them while the watcher runs.
    let ids: Vec<GlyphId> = fixture.workspace.font().glyphs().take(10).map(Glyph::id).collect();
    let changes = ids
        .iter()
        .map(|id| {
            let before = fixture.workspace.font().glyph(id).unwrap().clone();
            let mut after = before.clone();
            let layer_id = after.layers().keys().next().unwrap().clone();
            let mut layer = (**after.layers().get(&layer_id).unwrap()).clone();
            layer.set_width(layer.width() + 1.0);
            after.set_layer(layer);
            FontChange::Glyph(Box::new(Replacement { before: Some(before), after: Some(after) }))
        })
        .collect();
    fixture.workspace.persist_change_set(FontChangeSet::new(changes), true).unwrap();
    fixture.sync.unsaved.extend(ids.iter().cloned());

    let glyphs: Vec<Glyph> = ids.iter().map(|id| fixture.workspace.font().glyph(id).unwrap().clone()).collect();
    let refs: Vec<&Glyph> = glyphs.iter().collect();
    let sync = &mut fixture.sync;
    let watched = watch(&dir, || sync.write(&refs));
    let paths = changed_paths(&fixture.sync, &watched);
    let (report, applied, _, _) = sync_in(&mut fixture, &paths);
    eprintln!("own save of 10 glyphs: {} events, {} paths, ignored {}, imported {}", watched.events, paths.len(), report.ignored_own, applied.changes.len());
    assert_eq!(report.ignored_own, 10);
    assert!(applied.changes.is_empty());
}

#[test]
fn unsaved_edits_survive_and_same_glyph_changes_conflict() {
    let mut fixture = open(MUTATOR);
    let dir = fixture.sync.dir.clone();
    let [a, b, c] = ["A", "B", "C"].map(|n| glyph_by_name(&fixture, n).id());

    // Unsaved local edits to A and B.
    let changes = [&a, &b]
        .iter()
        .map(|id| {
            let before = fixture.workspace.font().glyph(id).unwrap().clone();
            let mut after = before.clone();
            after.set_name(format!("{}.local", before.name()).as_str());
            FontChange::Glyph(Box::new(Replacement { before: Some(before), after: Some(after) }))
        })
        .collect();
    fixture.workspace.persist_change_set(FontChangeSet::new(changes), true).unwrap();
    fixture.sync.unsaved.extend([a.clone(), b.clone()]);

    // A pull changes B and C on disk.
    let watched = watch(&dir, || {
        bump_advance(&dir.join(file_name(&b)), 5.0);
        bump_advance(&dir.join(file_name(&c)), 5.0);
    });
    let paths = changed_paths(&fixture.sync, &watched);
    let (report, _, _, _) = sync_in(&mut fixture, &paths);
    eprintln!("pull during unsaved edits: updated {:?}, conflicts {:?}", report.updated, report.conflicts);
    assert_eq!(report.updated, vec![c.clone()]);
    assert_eq!(report.conflicts, vec![b.clone()]);
    let font = fixture.workspace.font();
    assert_eq!(font.glyph(&a).unwrap().name(), "A.local", "A keeps its unsaved edit");
    assert_eq!(font.glyph(&b).unwrap().name(), "B.local", "B keeps the local edit until the user decides");
    let disk_c = std::fs::read(dir.join(file_name(&c))).unwrap();
    assert_eq!(content_hash(glyph_text(font.glyph(&c).unwrap()).as_bytes()), content_hash(&disk_c), "C took the disk version");
}

#[test]
fn conflict_markers_and_dangling_components_are_reported() {
    let mut fixture = open(MUTATOR);
    let dir = fixture.sync.dir.clone();
    let d = glyph_by_name(&fixture, "D").id();
    let acute = glyph_by_name(&fixture, "acute").id();
    let watched = watch(&dir, || {
        let path = dir.join(file_name(&d));
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, format!("<<<<<<< HEAD\n{text}=======\n{text}>>>>>>> teammate\n")).unwrap();
        std::fs::remove_file(dir.join(file_name(&acute))).unwrap();
    });
    let paths = changed_paths(&fixture.sync, &watched);
    let (change_set, report, _) = fixture.sync.plan(&paths, fixture.workspace.font());
    eprintln!("invalid: {:?}\ndangling: {:?}", report.invalid.iter().map(|(f, e)| format!("{f}: {e:?}")).collect::<Vec<_>>(), report.dangling);
    assert_eq!(report.invalid.len(), 1);
    assert!(!report.dangling.is_empty(), "Aacute and friends point at the deleted acute");
    // What the engine does with a deletion that leaves components dangling.
    let outcome = fixture.workspace.persist_change_set(change_set, false);
    eprintln!("engine on a dangling delete: {:?}", outcome.err());
}

#[test]
fn deleting_a_glyph_file_needs_an_engine_glyph_delete() {
    let mut fixture = open(MUTATOR);
    let dir = fixture.sync.dir.clone();
    // A glyph nothing references, in the middle of the glyph order.
    let removed = glyph_by_name(&fixture, "S").id();
    let watched = watch(&dir, || std::fs::remove_file(dir.join(file_name(&removed))).unwrap());
    let paths = changed_paths(&fixture.sync, &watched);
    let (change_set, report, _) = fixture.sync.plan(&paths, fixture.workspace.font());
    assert_eq!(report.deleted, vec![removed]);
    assert!(report.dangling.is_empty());
    let outcome = fixture.workspace.persist_change_set(change_set, false);
    eprintln!("engine on deleting a mid-order glyph: {:?}", outcome.as_ref().err());
}

/// 65k glyphs: a pull that changes `changed` glyph files while the font is open.
fn cjk_pull(changed: usize) {
    let mut fixture = open(NOTO_CJK);
    let dir = fixture.sync.dir.clone();
    let files: Vec<PathBuf> = {
        let mut files: Vec<_> = all_json(&dir).into_iter().collect();
        files.sort();
        files
    };
    git(&dir, &["checkout", "-qb", "teammate"]);
    let step = (files.len() / changed).max(1);
    for path in files.iter().step_by(step).take(changed) {
        bump_advance(path, 1.0);
    }
    git(&dir, &["commit", "-qam", "teammate"]);
    git(&dir, &["checkout", "-q", "main"]);
    let paths = all_json(&dir);
    sync_in(&mut fixture, &paths);

    let start = Instant::now();
    let watched = watch(&dir, || git(&dir, &["checkout", "-q", "teammate"]));
    let checkout_and_settle = start.elapsed();
    let paths = changed_paths(&fixture.sync, &watched);
    {
        let (change_set, _, _) = fixture.sync.plan(&paths, fixture.workspace.font());
        let mut font = fixture.workspace.font().clone();
        let start = Instant::now();
        font.apply_change_set(&change_set).unwrap();
        eprintln!("in-memory apply_change_set alone: {}", ms(start.elapsed()));
    }
    let (report, _, plan, apply) = sync_in(&mut fixture, &paths);
    eprintln!(
        "CJK pull of {changed} glyphs: checkout+settle {} ({} events, rescan {}), {} paths to check, plan (read+hash+parse) {}, apply {}; updated {}, ignored {}",
        ms(checkout_and_settle), watched.events, watched.rescan, paths.len(), ms(plan), ms(apply), report.updated.len(), report.ignored_own
    );
    assert_eq!(report.updated.len(), changed.min(files.len()));
}

#[test]
#[ignore = "65k-glyph font; run with --ignored"]
fn cjk_pull_of_1000_glyphs() {
    cjk_pull(1000);
}

#[test]
#[ignore = "65k-glyph font; run with --ignored"]
fn cjk_pull_of_every_glyph() {
    cjk_pull(65_535);
}

/// Whole-glyph versus layer-only replacements on a 65k-glyph font: which change
/// shape sync-in should emit for an outline edit.
#[test]
#[ignore = "65k-glyph font; run with --ignored"]
fn cjk_change_shape_cost() {
    let store = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(NOTO_CJK, store.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    let font = workspace.font().clone();
    let glyphs: Vec<&Glyph> = font.glyphs().collect();
    for n in [1usize, 10, 100, 1000] {
        let picked: Vec<&Glyph> = glyphs.iter().step_by(glyphs.len() / n).take(n).copied().collect();
        let edited = |glyph: &Glyph| {
            let mut glyph = glyph.clone();
            let layer_id = glyph.layers().keys().next().unwrap().clone();
            let mut layer = (**glyph.layers().get(&layer_id).unwrap()).clone();
            layer.set_width(layer.width() + 1.0);
            glyph.set_layer(layer);
            glyph
        };
        let whole = FontChangeSet::new(picked.iter().map(|g| FontChange::Glyph(Box::new(Replacement { before: Some((*g).clone()), after: Some(edited(g)) }))).collect());
        let layers = FontChangeSet::new(
            picked
                .iter()
                .map(|g| {
                    let after = edited(g);
                    let layer_id = g.layers().keys().next().unwrap().clone();
                    FontChange::Layer {
                        glyph_id: g.id(),
                        layer: Replacement { before: g.layers().get(&layer_id).cloned(), after: after.layers().get(&layer_id).cloned() },
                        structural: false,
                    }
                })
                .collect(),
        );
        let mut a = font.clone();
        let start = Instant::now();
        a.apply_change_set(&whole).unwrap();
        let whole_time = start.elapsed();
        let mut b = font.clone();
        let start = Instant::now();
        b.apply_change_set(&layers).unwrap();
        let layer_time = start.elapsed();
        eprintln!("{n:>4} glyphs: whole-glyph changes {}  layer changes {}", ms(whole_time), ms(layer_time));
    }
}
