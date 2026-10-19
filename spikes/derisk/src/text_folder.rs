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
    writeln!(out, "{{\n  \"id\": {},\n  \"name\": {},\n  \"unicodes\": {},", json(&glyph.id().to_string()), json(glyph.name()), json(&unicodes)).unwrap();
    if !glyph.axes().is_empty() {
        out.push_str("  \"axes\": [\n");
        for (i, axis) in glyph.axes().iter().enumerate() {
            let comma = if i + 1 < glyph.axes().len() { "," } else { "" };
            writeln!(out, "    {}{comma}", json(axis)).unwrap();
        }
        out.push_str("  ],\n");
    }
    out.push_str("  \"layers\": {\n");
    let mut layers: Vec<_> = glyph.layers().values().collect();
    layers.sort_by_key(|layer| layer.id().to_string());
    for (li, layer) in layers.iter().enumerate() {
        writeln!(out, "    {}: {{\n      \"source\": {},", json(&layer.id().to_string()), json(&layer.source_id().to_string())).unwrap();
        if !layer.location().is_empty() {
            writeln!(out, "      \"at\": {},", json(&layer.location().0)).unwrap();
        }
        writeln!(out, "      \"advance\": {},\n      \"contours\": [", num(layer.width())).unwrap();
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
            let mut extra = String::new();
            if !component.location().is_empty() {
                write!(extra, ", \"location\": {}", json(&component.location().0)).unwrap();
            }
            if component.inheritance() != shift_font::AxisInheritance::Parent {
                write!(extra, ", \"inherit\": {}", json(&component.inheritance())).unwrap();
            }
            writeln!(out, "        {{ \"id\": {}, \"base\": {}, \"transform\": {}, \"alignment\": {}{extra} }}{comma}", json(&component.id().to_string()), json(&component.base_glyph_id().to_string()), json(&component.transform().to_values().map(|v| v + 0.0).to_vec()), json(&component.alignment())).unwrap();
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
    #[serde(default)]
    axes: Vec<shift_font::GlyphAxis>,
    layers: BTreeMap<String, LayerDoc>,
}

#[derive(Deserialize)]
struct LayerDoc {
    source: String,
    #[serde(default)]
    at: BTreeMap<shift_font::AxisId, f64>,
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
    #[serde(default)]
    location: BTreeMap<shift_font::AxisId, f64>,
    #[serde(default)]
    inherit: shift_font::AxisInheritance,
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
    /// A layer or component location names an axis neither the font nor the
    /// glyph (or the component's base glyph) has.
    UnknownAxis(String),
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
    let sources: HashSet<SourceId> = font.sources().iter().map(|s| s.id()).collect();
    parse_glyph_with_sources(file, bytes, font, current, known_glyphs, &sources)
}

/// [`parse_glyph`] against the sources the font will have after a pull.
pub fn parse_glyph_with_sources(
    file: &str,
    bytes: &[u8],
    font: &Font,
    current: Option<&Glyph>,
    known_glyphs: &HashSet<GlyphId>,
    sources: &HashSet<SourceId>,
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
    let mut glyph_axes: HashSet<shift_font::AxisId> = font.axes().iter().map(|a| a.id()).collect();
    glyph_axes.extend(doc.axes.iter().map(|a| a.id.clone()));
    glyph.set_axes(doc.axes);
    for (layer_key, layer_doc) in doc.layers {
        let source_id = SourceId::from_raw(&layer_doc.source);
        if !sources.contains(&source_id) {
            return Err(Invalid::UnknownSource(layer_doc.source));
        }
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(&layer_key), source_id, layer_doc.advance);
        if let Some(axis) = layer_doc.at.keys().find(|axis| !glyph_axes.contains(*axis)) {
            return Err(Invalid::UnknownAxis(axis.to_string()));
        }
        layer.set_location(shift_font::LayerLocation(layer_doc.at));
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
            // The base's own axes may be unknown here when it changes in the same
            // pull; font axes and the base's current axes are checked.
            if let Some(base) = font.glyph(&component.base_glyph_id()) {
                let base_axes: HashSet<shift_font::AxisId> = font.axes().iter().map(|a| a.id()).chain(base.axes().iter().map(|a| a.id.clone())).collect();
                if let Some(axis) = component_doc.location.keys().find(|axis| !base_axes.contains(*axis)) {
                    return Err(Invalid::UnknownAxis(axis.to_string()));
                }
            }
            component.set_location(shift_font::ComponentLocation(component_doc.location));
            component.set_inheritance(component_doc.inherit);
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
        let sources: HashSet<SourceId> = font.sources().iter().map(|s| s.id()).collect();
        self.plan_with_sources(paths, font, &sources)
    }

    pub fn plan_with_sources(&self, paths: &HashSet<PathBuf>, font: &Font, sources: &HashSet<SourceId>) -> (FontChangeSet, SyncInReport, HashMap<String, Option<u64>>) {
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
            bytes.as_ref().map(|bytes| parse_glyph_with_sources(file, bytes, font, font.glyph(&id), &known, sources))
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

// ---------------------------------------------------------------------------
// Spike 11: font-level files, and "unsaved" as "differs from disk".

use shift_font::{KerningGroupId, KerningPair, KerningSide, SourceCollection};

fn pretty<T: serde::Serialize + ?Sized>(value: &T) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap();
    text.push('\n');
    text
}

fn side_text(side: &KerningSide) -> String {
    match side {
        KerningSide::Glyph(id) => id.to_string(),
        KerningSide::Group(id) => format!("@{id}"),
    }
}

fn parse_side(text: &str) -> KerningSide {
    match text.strip_prefix('@') {
        Some(group) => KerningSide::Group(KerningGroupId::from_raw(group)),
        None => KerningSide::Glyph(GlyphId::from_raw(text)),
    }
}

/// Every font-level file, by path relative to the folder root.
pub fn font_files(font: &Font) -> BTreeMap<String, String> {
    let mut files = BTreeMap::new();
    files.insert("font/metadata.json".into(), pretty(font.metadata()));
    files.insert("font/axes.json".into(), pretty(font.axes()));
    let sources = SourceCollection { sources: font.sources().to_vec(), default_source_id: font.default_source_id() };
    files.insert("font/sources.json".into(), pretty(&sources));
    let groups: BTreeMap<String, _> = font.kerning().all_groups().map(|(id, group)| (id.to_string(), group)).collect();
    files.insert("font/kerning-groups.json".into(), pretty(&groups));
    for (source_id, kerning) in font.kerning().sources() {
        let mut text = String::new();
        for (pair, value) in kerning.pairs() {
            writeln!(text, "{}\t{}\t{}", side_text(&pair.first), side_text(&pair.second), num(value)).unwrap();
        }
        files.insert(format!("kerning/{source_id}.txt"), text);
    }
    if let Some(fea) = font.features().fea_source() {
        files.insert("font/features.fea".into(), fea.to_string());
    }
    let order: String = font.glyphs().map(|g| format!("{}\n", g.id())).collect();
    files.insert("font/glyph-order.txt".into(), order);
    files
}

#[derive(Debug, Default)]
pub struct FontLevelReport {
    pub changed_files: Vec<String>,
    /// Changes the engine has no way to apply.
    pub unsupported: Vec<String>,
    /// Kerning that names a glyph or group the pulled font doesn't have.
    pub dangling_kerning: Vec<String>,
    /// Feature code that names a glyph this pull renamed away.
    pub stale_feature_names: Vec<String>,
}

impl FolderSync {
    pub fn write_font_files(&mut self, font: &Font) {
        for (rel, text) in font_files(font) {
            let path = self.dir.join(&rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let tmp = path.with_extension("tmp");
            fs::write(&tmp, text.as_bytes()).unwrap();
            fs::rename(&tmp, &path).unwrap();
            self.last_known.insert(rel, content_hash(text.as_bytes()));
        }
    }

    fn read_changed(&self, rel: &str) -> Option<Option<Vec<u8>>> {
        let bytes = fs::read(self.dir.join(rel)).ok();
        let hash = bytes.as_deref().map(content_hash);
        (hash != self.last_known.get(rel).copied()).then_some(bytes)
    }

    /// Plans a whole pull: font-level files first, then glyph files validated
    /// against the font as the pull leaves it (its sources, its glyphs).
    pub fn plan_pull(&self, glyph_paths: &HashSet<PathBuf>, font: &Font) -> (FontChangeSet, SyncInReport, FontLevelReport, HashMap<String, Option<u64>>) {
        let mut report = FontLevelReport::default();
        let mut changes = Vec::new();
        let mut accepted = HashMap::new();
        let mut post_sources: HashSet<SourceId> = font.sources().iter().map(|s| s.id()).collect();
        let mut post_groups: HashSet<KerningGroupId> = font.kerning().all_groups().map(|(id, _)| id.clone()).collect();

        let accept = |rel: &str, bytes: &Option<Vec<u8>>, accepted: &mut HashMap<String, Option<u64>>, report: &mut FontLevelReport| {
            accepted.insert(rel.to_string(), bytes.as_deref().map(content_hash));
            report.changed_files.push(rel.to_string());
        };

        if let Some(bytes) = self.read_changed("font/metadata.json") {
            let after = serde_json::from_slice(bytes.as_deref().unwrap()).unwrap();
            changes.push(FontChange::Metadata(Box::new(Replacement { before: font.metadata().clone(), after })));
            accept("font/metadata.json", &bytes, &mut accepted, &mut report);
        }
        if let Some(bytes) = self.read_changed("font/axes.json") {
            let after = serde_json::from_slice(bytes.as_deref().unwrap()).unwrap();
            changes.push(FontChange::Axes(Replacement { before: font.axes().to_vec(), after }));
            accept("font/axes.json", &bytes, &mut accepted, &mut report);
        }
        if let Some(bytes) = self.read_changed("font/sources.json") {
            let after: SourceCollection = serde_json::from_slice(bytes.as_deref().unwrap()).unwrap();
            post_sources = after.sources.iter().map(|s| s.id()).collect();
            let before = SourceCollection { sources: font.sources().to_vec(), default_source_id: font.default_source_id() };
            changes.push(FontChange::Sources(Replacement { before, after }));
            accept("font/sources.json", &bytes, &mut accepted, &mut report);
        }
        if let Some(bytes) = self.read_changed("font/kerning-groups.json") {
            let after: BTreeMap<String, shift_font::KerningGroup> = serde_json::from_slice(bytes.as_deref().unwrap()).unwrap();
            let after: BTreeMap<KerningGroupId, _> = after.into_iter().map(|(id, g)| (KerningGroupId::from_raw(&id), g)).collect();
            post_groups = after.keys().cloned().collect();
            let mut ids: HashSet<KerningGroupId> = after.keys().cloned().collect();
            ids.extend(font.kerning().all_groups().map(|(id, _)| id.clone()));
            for id in ids {
                let before = font.kerning().group(&id).cloned();
                let after = after.get(&id).cloned();
                if before != after {
                    changes.push(FontChange::KerningGroup { group_id: id, group: Replacement { before, after } });
                }
            }
            accept("font/kerning-groups.json", &bytes, &mut accepted, &mut report);
        }
        if let Some(bytes) = self.read_changed("font/features.fea") {
            let after = bytes.as_deref().map(|b| String::from_utf8(b.to_vec()).unwrap()).filter(|t| !t.is_empty());
            let before = font.features().fea_source().map(str::to_string);
            changes.push(FontChange::FeatureSource(Replacement { before, after }));
            accept("font/features.fea", &bytes, &mut accepted, &mut report);
        }

        // Glyph files, validated against the post-pull sources.
        let (glyph_changes, glyph_report, glyph_accepted) = self.plan_with_sources(glyph_paths, font, &post_sources);
        accepted.extend(glyph_accepted);

        // The post-pull glyph set, for kerning validation and rename checks.
        let mut post_glyphs: HashMap<GlyphId, String> = font.glyphs().map(|g| (g.id(), g.name().to_string())).collect();
        for change in &glyph_changes.changes {
            if let FontChange::Glyph(value) = change {
                if let Some(before) = &value.before {
                    post_glyphs.remove(&before.id());
                }
                if let Some(after) = &value.after {
                    post_glyphs.insert(after.id(), after.name().to_string());
                }
            }
        }

        // Kerning per source: one file each, diffed pair by pair.
        let kerning_dir = self.dir.join("kerning");
        let mut kerning_files: HashSet<String> = self.last_known.keys().filter(|k| k.starts_with("kerning/")).cloned().collect();
        if let Ok(entries) = fs::read_dir(&kerning_dir) {
            kerning_files.extend(entries.filter_map(|e| e.ok()).map(|e| format!("kerning/{}", e.file_name().to_string_lossy())).filter(|f| f.ends_with(".txt")));
        }
        for rel in kerning_files {
            let Some(bytes) = self.read_changed(&rel) else { continue };
            let source_id = SourceId::from_raw(rel.trim_start_matches("kerning/").trim_end_matches(".txt"));
            let mut after = BTreeMap::new();
            for line in bytes.as_deref().map(|b| std::str::from_utf8(b).unwrap()).unwrap_or("").lines() {
                let mut parts = line.split('\t');
                let (first, second, value) = (parts.next().unwrap(), parts.next().unwrap(), parts.next().unwrap());
                let pair = KerningPair::new(parse_side(first), parse_side(second));
                for side in [&pair.first, &pair.second] {
                    let known = match side {
                        KerningSide::Glyph(id) => post_glyphs.contains_key(id),
                        KerningSide::Group(id) => post_groups.contains(id),
                    };
                    if !known {
                        report.dangling_kerning.push(format!("{rel}: {}", side_text(side)));
                    }
                }
                after.insert(pair, value.parse::<f64>().unwrap());
            }
            let before: BTreeMap<KerningPair, f64> = font.kerning().source(&source_id).map(|k| k.pairs().map(|(p, v)| (p.clone(), v)).collect()).unwrap_or_default();
            let mut pairs: HashSet<&KerningPair> = before.keys().collect();
            pairs.extend(after.keys());
            for pair in pairs {
                let (b, a) = (before.get(pair).copied(), after.get(pair).copied());
                if b != a {
                    changes.push(FontChange::KerningValue { source_id: source_id.clone(), pair: pair.clone(), value: Replacement { before: b, after: a } });
                }
            }
            accept(&rel, &bytes, &mut accepted, &mut report);
        }

        // Glyph order: the engine can append new glyphs but not reorder.
        if let Some(bytes) = self.read_changed("font/glyph-order.txt") {
            let pulled: Vec<GlyphId> = bytes.as_deref().map(|b| std::str::from_utf8(b).unwrap()).unwrap_or("").lines().map(GlyphId::from_raw).collect();
            let current: Vec<GlyphId> = font.glyphs().map(Glyph::id).collect();
            let kept: Vec<&GlyphId> = pulled.iter().filter(|id| current.contains(id)).collect();
            let current_kept: Vec<&GlyphId> = current.iter().filter(|id| pulled.contains(id)).collect();
            if kept != current_kept {
                report.unsupported.push("font/glyph-order.txt: glyphs reordered".into());
            } else {
                accept("font/glyph-order.txt", &bytes, &mut accepted, &mut report);
            }
        }

        // Feature code that still names a glyph this pull renamed.
        let fea = changes.iter().find_map(|c| match c {
            FontChange::FeatureSource(v) => Some(v.after.clone()),
            _ => None,
        });
        let fea = fea.unwrap_or_else(|| font.features().fea_source().map(str::to_string));
        if let Some(fea) = fea {
            let post_names: HashSet<&str> = post_glyphs.values().map(String::as_str).collect();
            for glyph in font.glyphs() {
                let renamed = post_glyphs.get(&glyph.id()).is_some_and(|name| name != glyph.name());
                if renamed && !post_names.contains(glyph.name()) && fea_mentions(&fea, glyph.name()) {
                    report.stale_feature_names.push(glyph.name().to_string());
                }
            }
        }

        changes.extend(glyph_changes.changes);
        (FontChangeSet::new(changes), glyph_report, report, accepted)
    }

    /// "Unsaved" means "differs from disk": a glyph whose rendered text doesn't
    /// match the file Shift last knew. Undoing a pull therefore makes exactly
    /// the pulled glyphs unsaved, and redoing it makes them clean again.
    pub fn refresh_unsaved(&mut self, font: &Font, glyph_ids: impl IntoIterator<Item = GlyphId>) {
        for id in glyph_ids {
            let file = file_name(&id);
            let rendered = font.glyph(&id).map(|g| content_hash(glyph_text(g).as_bytes()));
            if rendered == self.last_known.get(&file).copied() {
                self.unsaved.remove(&id);
            } else {
                self.unsaved.insert(id);
            }
        }
    }
}

/// Whether FEA text names `glyph` as a token (not as part of a longer name).
fn fea_mentions(fea: &str, glyph: &str) -> bool {
    fea.split(|c: char| c.is_whitespace() || "[]{};,'\\-".contains(c)).any(|token| token == glyph)
}
