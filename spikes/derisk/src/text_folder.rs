//! A spike of the `.shift` text folder: one JSON file per glyph, synced both
//! ways with the working store.
//!
//! Sync out renders changed glyphs and remembers each file's hash. Sync in
//! classifies changed paths against those hashes, parses and validates the
//! files, and applies them as one `FontChangeSet` through the workspace, the
//! same path as edits from another writer.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use shift_font::{
    Anchor, AnchorId, Component, ComponentAlignment, ComponentId, Contour, ContourId,
    DecomposedTransform, Font, FontChange, FontChangeSet, Glyph, GlyphId, GlyphLayer, LayerId,
    Point, PointId, PointType, Replacement, SourceId,
};

fn json<T: serde::Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string(value).unwrap()
}

/// Numbers in the format: shortest round-trip text, `-0` written as `0`.
fn num(value: f64) -> String {
    json(&(value + 0.0))
}

pub fn file_name(id: &GlyphId) -> String {
    format!("{id}.json")
}

pub fn content_hash(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// One glyph file: pretty structure, one point per line.
pub fn glyph_text(glyph: &Glyph) -> String {
    let mut out = String::new();
    let unicodes: Vec<String> = glyph.unicodes().iter().map(|u| format!("{u:04X}")).collect();
    writeln!(out, "{{\n  \"id\": {},\n  \"name\": {},\n  \"unicodes\": {},\n  \"layers\": {{", json(&glyph.id().to_string()), json(glyph.name()), json(&unicodes)).unwrap();
    let mut layers: Vec<_> = glyph.layers().values().collect();
    layers.sort_by_key(|layer| layer.id().to_string());
    for (li, layer) in layers.iter().enumerate() {
        writeln!(out, "    {}: {{\n      \"source\": {},\n      \"advance\": {},\n      \"contours\": [", json(&layer.id().to_string()), json(&layer.source_id().to_string()), num(layer.width())).unwrap();
        let contours: Vec<_> = layer.contours_iter().collect();
        for (ci, contour) in contours.iter().enumerate() {
            writeln!(out, "        {{ \"id\": {}, \"closed\": {}, \"points\": [", json(&contour.id().to_string()), contour.is_closed()).unwrap();
            let points = contour.points();
            for (pi, point) in points.iter().enumerate() {
                let comma = if pi + 1 < points.len() { "," } else { "" };
                writeln!(out, "          [{}, {}, {}, {}, {}]{comma}", json(&point.id().to_string()), num(point.x()), num(point.y()), json(&point.point_type()), point.is_smooth()).unwrap();
            }
            let comma = if ci + 1 < contours.len() { "," } else { "" };
            writeln!(out, "        ] }}{comma}").unwrap();
        }
        out.push_str("      ],\n      \"components\": [\n");
        let components: Vec<_> = layer.components_iter().collect();
        for (i, component) in components.iter().enumerate() {
            let comma = if i + 1 < components.len() { "," } else { "" };
            writeln!(out, "        {{ \"id\": {}, \"base\": {}, \"transform\": {}, \"alignment\": {} }}{comma}", json(&component.id().to_string()), json(&component.base_glyph_id().to_string()), json(&component.transform().to_values().map(|v| v + 0.0).to_vec()), json(&component.alignment())).unwrap();
        }
        out.push_str("      ],\n      \"anchors\": [\n");
        let anchors: Vec<_> = layer.anchors_iter().collect();
        for (i, anchor) in anchors.iter().enumerate() {
            let comma = if i + 1 < anchors.len() { "," } else { "" };
            writeln!(out, "        {{ \"id\": {}, \"name\": {}, \"x\": {}, \"y\": {} }}{comma}", json(&anchor.id().to_string()), json(&anchor.name()), num(anchor.x()), num(anchor.y())).unwrap();
        }
        let comma = if li + 1 < layers.len() { "," } else { "" };
        out.push_str("      ]");
        if let Some(height) = layer.height() {
            write!(out, ",\n      \"height\": {}", num(height)).unwrap();
        }
        if !layer.guidelines().is_empty() {
            out.push_str(",\n      \"guidelines\": [\n");
            let guidelines = layer.guidelines();
            for (i, guideline) in guidelines.iter().enumerate() {
                let comma = if i + 1 < guidelines.len() { "," } else { "" };
                writeln!(out, "        {}{comma}", json(guideline)).unwrap();
            }
            out.push_str("      ]");
        }
        if !layer.lib().is_empty() {
            write!(out, ",\n      \"lib\": {}", json(layer.lib())).unwrap();
        }
        writeln!(out, "\n    }}{comma}").unwrap();
    }
    out.push_str("  }\n}\n");
    out
}

#[derive(Deserialize)]
struct GlyphDoc {
    id: String,
    name: String,
    unicodes: Vec<String>,
    layers: BTreeMap<String, LayerDoc>,
}

#[derive(Deserialize)]
struct LayerDoc {
    source: String,
    advance: f64,
    contours: Vec<ContourDoc>,
    components: Vec<ComponentDoc>,
    anchors: Vec<AnchorDoc>,
    #[serde(default)]
    height: Option<f64>,
    #[serde(default)]
    guidelines: Vec<shift_font::Guideline>,
    #[serde(default)]
    lib: Option<shift_font::LibData>,
}

#[derive(Deserialize)]
struct ContourDoc {
    id: String,
    closed: bool,
    points: Vec<(String, f64, f64, PointType, bool)>,
}

#[derive(Deserialize)]
struct ComponentDoc {
    id: String,
    base: String,
    transform: [f64; DecomposedTransform::VALUE_COUNT],
    alignment: ComponentAlignment,
}

#[derive(Deserialize)]
struct AnchorDoc {
    id: String,
    name: Option<String>,
    x: f64,
    y: f64,
}

#[derive(Debug)]
pub enum Invalid {
    /// Not JSON: includes files left with Git conflict markers.
    Syntax(String),
    FileIdMismatch { file: String, id: String },
    UnknownSource(String),
    UnknownComponentBase(String),
    BadUnicode(String),
}

/// Parses one glyph file into a whole glyph, validated against `font` (sources
/// exist, component bases exist). Fields the file doesn't carry (lib,
/// category) are kept from `current`.
pub fn parse_glyph(
    file: &str,
    bytes: &[u8],
    font: &Font,
    current: Option<&Glyph>,
    known_glyphs: &HashSet<GlyphId>,
) -> Result<Glyph, Invalid> {
    let doc: GlyphDoc = serde_json::from_slice(bytes).map_err(|e| Invalid::Syntax(e.to_string()))?;
    let id = GlyphId::from_raw(&doc.id);
    if file_name(&id) != file {
        return Err(Invalid::FileIdMismatch { file: file.to_string(), id: doc.id });
    }
    let mut glyph = match current {
        Some(current) => {
            let mut glyph = current.clone();
            for layer_id in current.layers().keys() {
                glyph.remove_layer(layer_id.clone());
            }
            glyph.set_name(doc.name.as_str());
            glyph
        }
        None => Glyph::with_id(id.clone(), doc.name.as_str()),
    };
    let unicodes = doc
        .unicodes
        .iter()
        .map(|u| u32::from_str_radix(u, 16).map_err(|_| Invalid::BadUnicode(u.clone())))
        .collect::<Result<Vec<_>, _>>()?;
    glyph.set_unicodes(unicodes);
    for (layer_key, layer_doc) in doc.layers {
        let source_id = SourceId::from_raw(&layer_doc.source);
        if font.source(&source_id).is_none() {
            return Err(Invalid::UnknownSource(layer_doc.source));
        }
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(&layer_key), source_id, layer_doc.advance);
        for contour_doc in layer_doc.contours {
            let mut contour = Contour::with_id(ContourId::from_raw(&contour_doc.id));
            for (point_id, x, y, point_type, smooth) in contour_doc.points {
                contour.push_point(Point::new(PointId::from_raw(&point_id), x, y, point_type, smooth));
            }
            if contour_doc.closed {
                contour.close();
            }
            layer.add_contour(contour);
        }
        for component_doc in layer_doc.components {
            let base_id = GlyphId::from_raw(&component_doc.base);
            if !known_glyphs.contains(&base_id) {
                return Err(Invalid::UnknownComponentBase(component_doc.base));
            }
            let base_name = font.glyph(&base_id).map(|g| g.name().to_string()).unwrap_or_default();
            let mut component = Component::with_id(
                ComponentId::from_raw(&component_doc.id),
                base_id,
                base_name.as_str(),
                DecomposedTransform::from_values(component_doc.transform),
            );
            component.set_alignment(component_doc.alignment);
            layer.add_component(component);
        }
        for anchor_doc in layer_doc.anchors {
            layer.add_anchor(Anchor::with_id(AnchorId::from_raw(&anchor_doc.id), anchor_doc.name, anchor_doc.x, anchor_doc.y));
        }
        layer.set_height(layer_doc.height);
        for guideline in layer_doc.guidelines {
            layer.add_guideline(guideline);
        }
        if let Some(lib) = layer_doc.lib {
            *layer.lib_mut() = lib;
        }
        glyph.set_layer(Arc::new(layer));
    }
    Ok(glyph)
}

/// A file's stat, as Git's index keeps it: a change to any field means the
/// file may have changed. `ctime` catches edits that restore `mtime` (such as
/// `cp -p`), because no tool can set it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileStat {
    len: u64,
    mtime_ns: i128,
    ctime_ns: i128,
    ino: u64,
}

impl FileStat {
    pub fn of(path: &Path) -> Option<Self> {
        use std::os::unix::fs::MetadataExt;
        let meta = fs::symlink_metadata(path).ok()?;
        Some(Self {
            len: meta.len(),
            mtime_ns: i128::from(meta.mtime()) * 1_000_000_000 + i128::from(meta.mtime_nsec()),
            ctime_ns: i128::from(meta.ctime()) * 1_000_000_000 + i128::from(meta.ctime_nsec()),
            ino: meta.ino(),
        })
    }
}

/// Files whose stat was recorded this close to the recording time are
/// "racily clean" (Git's term): a same-size edit in the same timestamp tick
/// would leave the stat unchanged, so a rescan hashes them anyway.
const RACY_WINDOW_NS: i128 = 2_000_000_000;

/// What Shift knows about the folder: the hash and stat of every file it last
/// wrote or read, and which glyphs have unsaved local edits.
pub struct FolderSync {
    pub dir: PathBuf,
    pub last_known: HashMap<String, u64>,
    pub stats: HashMap<String, (FileStat, i128)>,
    pub unsaved: HashSet<GlyphId>,
}

#[derive(Debug, Default)]
pub struct Rescan {
    pub files_seen: usize,
    pub stat_changed: usize,
    pub racy: usize,
    pub missing: usize,
}

fn now_ns() -> i128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as i128
}

#[derive(Debug, Default)]
pub struct SyncInReport {
    /// Paths whose content is what Shift already knows (its own writes).
    pub ignored_own: usize,
    pub updated: Vec<GlyphId>,
    pub added: Vec<GlyphId>,
    pub deleted: Vec<GlyphId>,
    /// Changed on disk while the glyph has unsaved local edits.
    pub conflicts: Vec<GlyphId>,
    pub invalid: Vec<(String, Invalid)>,
    /// Glyphs whose components point at a glyph this change deletes.
    pub dangling: Vec<(GlyphId, GlyphId)>,
}

impl FolderSync {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into(), last_known: HashMap::new(), stats: HashMap::new(), unsaved: HashSet::new() }
    }

    fn record_stat(&mut self, file: &str) {
        match FileStat::of(&self.dir.join(file)) {
            Some(stat) => {
                self.stats.insert(file.to_string(), (stat, now_ns()));
            }
            None => {
                self.stats.remove(file);
            }
        }
    }

    /// The fallback when watcher events can't be trusted (queue overflow,
    /// FSEvents coalescing, or the app was closed): stat every file and return
    /// the paths that may have changed. `plan` then hashes only those.
    pub fn rescan(&self) -> (HashSet<PathBuf>, Rescan) {
        let mut report = Rescan::default();
        let mut paths = HashSet::new();
        let mut seen = HashSet::new();
        for entry in fs::read_dir(&self.dir).unwrap() {
            let path = entry.unwrap().path();
            let Some(file) = path.file_name().and_then(|f| f.to_str()) else { continue };
            if !file.ends_with(".json") || file.starts_with('.') {
                continue;
            }
            report.files_seen += 1;
            seen.insert(file.to_string());
            let stat = FileStat::of(&path);
            match (self.stats.get(file), stat) {
                (Some((recorded, recorded_at)), Some(stat)) if *recorded == stat => {
                    if recorded.mtime_ns > recorded_at - RACY_WINDOW_NS {
                        report.racy += 1;
                        paths.insert(path);
                    }
                }
                _ => {
                    report.stat_changed += 1;
                    paths.insert(path);
                }
            }
        }
        for file in self.stats.keys() {
            if !seen.contains(file) {
                report.missing += 1;
                paths.insert(self.dir.join(file));
            }
        }
        (paths, report)
    }

    /// Sync out: write the given glyphs and remember their hashes.
    pub fn write(&mut self, glyphs: &[&Glyph]) {
        for glyph in glyphs {
            let name = file_name(&glyph.id());
            let text = glyph_text(glyph);
            let tmp = self.dir.join(format!(".{name}.tmp"));
            fs::write(&tmp, text.as_bytes()).unwrap();
            fs::rename(&tmp, self.dir.join(&name)).unwrap();
            self.last_known.insert(name.clone(), content_hash(text.as_bytes()));
            self.record_stat(&name);
            self.unsaved.remove(&glyph.id());
        }
    }

    /// Sync in: classify `paths`, parse and validate, and build one change set.
    /// Conflicting and invalid files are reported and left out.
    pub fn plan(&self, paths: &HashSet<PathBuf>, font: &Font) -> (FontChangeSet, SyncInReport, HashMap<String, Option<u64>>) {
        let mut report = SyncInReport::default();
        let candidates: Vec<(String, &PathBuf)> = paths
            .iter()
            .filter_map(|path| {
                let file = path.file_name()?.to_str()?;
                (file.ends_with(".json") && !file.starts_with('.')).then(|| (file.to_string(), path))
            })
            .collect();
        // Read and hash in parallel; most paths after a save are Shift's own.
        let read: Vec<(String, Option<Vec<u8>>, Option<u64>)> = parallel(&candidates, |(file, path)| {
            let bytes = fs::read(path).ok();
            let hash = bytes.as_deref().map(content_hash);
            (file.clone(), bytes, hash)
        });
        let mut reads = Vec::new();
        for (file, bytes, hash) in read {
            if hash == self.last_known.get(&file).copied() {
                report.ignored_own += 1;
                continue;
            }
            reads.push((file, bytes, hash));
        }

        let mut known: HashSet<GlyphId> = font.glyphs().map(Glyph::id).collect();
        for (file, bytes, _) in &reads {
            let id = GlyphId::from_raw(file.trim_end_matches(".json"));
            match bytes {
                Some(_) => known.insert(id),
                None => known.remove(&id),
            };
        }

        let parsed: Vec<Option<Result<Glyph, Invalid>>> = parallel(&reads, |(file, bytes, _)| {
            let id = GlyphId::from_raw(file.trim_end_matches(".json"));
            bytes.as_ref().map(|bytes| parse_glyph(file, bytes, font, font.glyph(&id), &known))
        });

        let mut changes = Vec::new();
        let mut accepted = HashMap::new();
        let mut deleted = HashSet::new();
        for ((file, _, hash), parsed) in reads.into_iter().zip(parsed) {
            let id = GlyphId::from_raw(file.trim_end_matches(".json"));
            if self.unsaved.contains(&id) {
                report.conflicts.push(id);
                continue;
            }
            let current = font.glyph(&id);
            match parsed {
                None => {
                    if let Some(current) = current {
                        changes.push(FontChange::Glyph(Box::new(Replacement { before: Some(current.clone()), after: None })));
                        report.deleted.push(id.clone());
                        deleted.insert(id);
                    }
                    accepted.insert(file, None);
                }
                Some(Ok(glyph)) => {
                    if current.is_some() {
                        report.updated.push(id);
                    } else {
                        report.added.push(id);
                    }
                    changes.push(FontChange::Glyph(Box::new(Replacement { before: current.cloned(), after: Some(glyph) })));
                    accepted.insert(file, hash);
                }
                Some(Err(invalid)) => report.invalid.push((file, invalid)),
            }
        }

        if !deleted.is_empty() {
            for glyph in font.glyphs() {
                if deleted.contains(&glyph.id()) {
                    continue;
                }
                for layer in glyph.layers().values() {
                    for component in layer.components_iter() {
                        if deleted.contains(&component.base_glyph_id()) {
                            report.dangling.push((glyph.id(), component.base_glyph_id()));
                        }
                    }
                }
            }
        }
        (FontChangeSet::new(changes), report, accepted)
    }

    /// Records that the accepted files are now known content.
    pub fn accept(&mut self, accepted: HashMap<String, Option<u64>>) {
        for (file, hash) in accepted {
            match hash {
                Some(hash) => self.last_known.insert(file.clone(), hash),
                None => self.last_known.remove(&file),
            };
            self.record_stat(&file);
        }
    }

    /// Records the current stat of files whose content matched what Shift
    /// knows, so later rescans skip them (clears racily clean entries).
    pub fn refresh_stats(&mut self, paths: &HashSet<PathBuf>) {
        for path in paths {
            let Some(file) = path.file_name().and_then(|f| f.to_str()) else { continue };
            let file = file.to_string();
            let known = self.last_known.get(&file).copied();
            let current = fs::read(path).ok().map(|bytes| content_hash(&bytes));
            if known.is_some() && known == current {
                self.record_stat(&file);
            }
        }
    }
}

/// Maps `items` across a few threads, keeping order.
fn parallel<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    const THREADS: usize = 8;
    if items.len() < 64 {
        return items.iter().map(&f).collect();
    }
    let chunk = items.len().div_ceil(THREADS);
    std::thread::scope(|scope| {
        let handles: Vec<_> = items.chunks(chunk).map(|part| scope.spawn(|| part.iter().map(&f).collect::<Vec<_>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}

pub fn all_json(dir: &Path) -> HashSet<PathBuf> {
    fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().is_some_and(|e| e == "json")).collect()
}
