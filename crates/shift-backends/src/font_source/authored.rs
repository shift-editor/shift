//! An authored source (a UFO, a designspace or a Glyphs file) read glyph by
//! glyph, for a reader that answers an engine's layer requests without
//! importing the file.
//!
//! Opening reads the font's top-level data as import does, and every glyph's
//! identity, advances, component bases and attaching anchors, without
//! converting any outline. A glyph is converted when it is asked for, by the
//! same conversion import runs, with the layer ids the directory gave it, so
//! a glyph read alone is the glyph a full import produces. Glyph ids come
//! from [`crate::SourceIds`], as for the retained source and import.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::PathBuf;

use rayon::prelude::*;
use shift_font::{CoreError, Font, Glyph, GlyphId, GlyphLayer, LayerId, Require};

use crate::font_loader::resolve;
use crate::{
    BackendError, BackendResult, FontFormat, FormatBackendError, FormatBackendResult, ImportReport,
};

/// One glyph as opening reads it, before any outline is converted.
pub(crate) struct AuthoredEntry {
    /// The glyph's identity, with each layer a placeholder that keeps its
    /// advance: what the directory lists.
    pub(crate) glyph: Glyph,
    /// The glyphs its components use in any layer, directly.
    pub(crate) bases: BTreeSet<GlyphId>,
    /// Its layers that carry an anchor marks attach to.
    pub(crate) attaching: Vec<LayerId>,
}

impl AuthoredEntry {
    pub(crate) fn new(glyph: Glyph) -> Self {
        Self {
            glyph,
            bases: BTreeSet::new(),
            attaching: Vec::new(),
        }
    }
}

/// One format's glyphs, by their position in the import stream.
pub(crate) trait AuthoredGlyphs: Send + Sync {
    fn glyph_count(&self) -> usize;

    /// The glyph at `index` as the directory lists it.
    ///
    /// # Errors
    ///
    /// Returns the format's error when the glyph cannot be read.
    fn entry(&self, index: usize) -> FormatBackendResult<AuthoredEntry>;

    /// The glyph at `index`, converted as import converts it, with the layer
    /// ids [`Self::entry`] gave it.
    ///
    /// # Errors
    ///
    /// Returns the format's error when the glyph cannot be read or converted.
    fn glyph(&self, index: usize) -> FormatBackendResult<Glyph>;
}

/// A read-only authored source that converts a glyph only when it is asked
/// for. Its answers never change: it reads the file once, at open, and again
/// for each glyph converted, and keeps no converted glyph.
pub struct AuthoredSource {
    glyphs: Box<dyn AuthoredGlyphs>,
    format: FontFormat,
    path: PathBuf,
    /// Each glyph's position in `glyphs`.
    glyph_index: HashMap<GlyphId, usize>,
    /// Each layer's glyph, by position in `glyphs`.
    layer_owners: HashMap<LayerId, usize>,
    /// Each glyph's direct component bases in id order, by position.
    bases: Box<[Box<[GlyphId]>]>,
    /// The glyphs that use each base directly.
    composites: HashMap<GlyphId, BTreeSet<GlyphId>>,
    /// The layers that carry an anchor marks attach to.
    attaching: HashSet<LayerId>,
    /// What import changes or leaves out of the file, as importing it would
    /// report it: kept for when the preview is saved as a document.
    report: ImportReport,
}

/// An authored source just opened, and its directory.
pub struct OpenedAuthoredSource {
    /// The font with every glyph's layers placeholders that keep their
    /// advances, in the order import inserts them: what an engine session
    /// opens with ([`shift_font::Font`] as `EngineSession::open_directory`
    /// takes it).
    pub directory: Font,
    pub source: AuthoredSource,
}

/// Why an [`AuthoredSource`] could not answer.
#[derive(Debug, thiserror::Error)]
pub enum AuthoredReadError {
    /// The source has no glyph or layer with the id asked for.
    #[error(transparent)]
    Missing(#[from] CoreError),

    /// The glyph's file could not be read or converted.
    #[error(transparent)]
    Source(#[from] BackendError),
}

impl AuthoredSource {
    /// Opens the UFO, designspace, or `.glyphs` / `.glyphspackage` source at
    /// `path` read-only.
    ///
    /// Reads the top-level data, and every glyph's identity, advances,
    /// component bases and anchor names, in parallel; converts no outline.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::MissingExtension`] or
    /// [`BackendError::UnsupportedFormat`] when `path` names no font format,
    /// [`BackendError::AuthoredUnsupported`] for a compiled font or a
    /// `.shift` document, and [`BackendError::Load`] when the source cannot
    /// be read.
    pub fn open(path: &str) -> BackendResult<OpenedAuthoredSource> {
        let resolved = resolve(path)?;
        let format = resolved.format;
        let path = resolved.path_buf;
        let load = |source: FormatBackendError| BackendError::load(format, path.clone(), source);
        let stream = AuthoredStream::open(format, resolved.path)
            .map_err(load)?
            .ok_or(BackendError::AuthoredUnsupported { format })?;
        let entries = (0..stream.glyphs.glyph_count())
            .into_par_iter()
            .map(|index| stream.glyphs.entry(index))
            .collect::<FormatBackendResult<Vec<_>>>()
            .map_err(load)?;
        Self::index(stream, entries, format, path.clone()).map_err(load)
    }

    /// Indexes `entries`, `stream`'s entries in stream order, and inserts
    /// them into its header as the directory.
    fn index(
        stream: AuthoredStream,
        entries: Vec<AuthoredEntry>,
        format: FontFormat,
        path: PathBuf,
    ) -> FormatBackendResult<OpenedAuthoredSource> {
        let AuthoredStream {
            mut header,
            glyphs,
            report,
        } = stream;
        let mut glyph_index = HashMap::with_capacity(entries.len());
        let mut layer_owners = HashMap::new();
        let mut bases = Vec::with_capacity(entries.len());
        let mut composites: HashMap<GlyphId, BTreeSet<GlyphId>> = HashMap::new();
        let mut attaching = HashSet::new();
        for (index, entry) in entries.into_iter().enumerate() {
            let glyph_id = entry.glyph.id();
            glyph_index.insert(glyph_id, index);
            layer_owners.extend(entry.glyph.layer_ids().map(|layer_id| (layer_id, index)));
            for base in &entry.bases {
                composites.entry(*base).or_default().insert(glyph_id);
            }
            bases.push(entry.bases.into_iter().collect());
            attaching.extend(entry.attaching);
            header.insert_glyph(entry.glyph)?;
        }
        Ok(OpenedAuthoredSource {
            directory: header,
            source: Self {
                glyphs,
                format,
                path,
                glyph_index,
                layer_owners,
                bases: bases.into_boxed_slice(),
                composites,
                attaching,
                report,
            },
        })
    }

    /// What importing the file would report changing or leaving out.
    pub fn report(&self) -> &ImportReport {
        &self.report
    }

    /// `glyph_id`, converted with every layer.
    ///
    /// # Errors
    ///
    /// Returns [`AuthoredReadError::Missing`] when the source has no such
    /// glyph, and [`AuthoredReadError::Source`] when it cannot be converted.
    pub fn glyph(&self, glyph_id: GlyphId) -> Result<Glyph, AuthoredReadError> {
        let index = *self.glyph_index.get(&glyph_id).require(&glyph_id)?;
        self.convert(index)
    }

    /// The layers `layer_ids` name, in request order, converting each of
    /// their glyphs once.
    ///
    /// # Errors
    ///
    /// Returns [`AuthoredReadError::Missing`] when the source has no layer
    /// with one of the ids, and [`AuthoredReadError::Source`] when a glyph
    /// cannot be converted.
    pub fn layers(&self, layer_ids: &[LayerId]) -> Result<Vec<GlyphLayer>, AuthoredReadError> {
        let owners = layer_ids
            .iter()
            .map(|layer_id| self.layer_owners.get(layer_id).require(layer_id).copied())
            .collect::<Result<Vec<_>, _>>()?;
        let unique: BTreeSet<usize> = owners.iter().copied().collect();
        let glyphs = unique
            .into_par_iter()
            .map(|index| Ok((index, self.convert(index)?)))
            .collect::<Result<HashMap<_, _>, AuthoredReadError>>()?;
        layer_ids
            .iter()
            .zip(owners)
            .map(|(layer_id, index)| {
                let layer = glyphs[&index].layer(*layer_id).require(layer_id)?;
                Ok(layer.clone())
            })
            .collect()
    }

    /// The direct component bases of each of `glyph_ids`, in request order,
    /// each list in id order; empty for a glyph the source lacks.
    pub fn component_bases(&self, glyph_ids: &[GlyphId]) -> Vec<Vec<GlyphId>> {
        glyph_ids
            .iter()
            .map(|glyph_id| self.bases_at(*glyph_id).to_vec())
            .collect()
    }

    /// Every glyph the components of `glyph_ids` use, transitively, other
    /// than `glyph_ids` themselves, in the order they are found.
    pub fn bases_of(&self, glyph_ids: &[GlyphId]) -> Vec<GlyphId> {
        let mut seen: HashSet<GlyphId> = glyph_ids.iter().copied().collect();
        let mut pending: Vec<GlyphId> = glyph_ids.to_vec();
        let mut found = Vec::new();
        while let Some(glyph_id) = pending.pop() {
            for base in self.bases_at(glyph_id) {
                if seen.insert(*base) {
                    found.push(*base);
                    pending.push(*base);
                }
            }
        }
        found
    }

    /// Glyphs with a component whose base is one of `glyph_ids`, directly, in
    /// id order.
    pub fn composites_of(&self, glyph_ids: &[GlyphId]) -> Vec<GlyphId> {
        let composites: BTreeSet<GlyphId> = glyph_ids
            .iter()
            .filter_map(|glyph_id| self.composites.get(glyph_id))
            .flatten()
            .copied()
            .collect();
        composites.into_iter().collect()
    }

    /// Those of `layer_ids` that carry an anchor marks attach to, in id
    /// order; a layer the source lacks carries none.
    pub fn attaching_anchor_layers(&self, layer_ids: &[LayerId]) -> Vec<LayerId> {
        let attaching: BTreeSet<LayerId> = layer_ids
            .iter()
            .copied()
            .filter(|layer_id| self.attaching.contains(layer_id))
            .collect();
        attaching.into_iter().collect()
    }

    fn bases_at(&self, glyph_id: GlyphId) -> &[GlyphId] {
        self.glyph_index
            .get(&glyph_id)
            .map_or(&[], |index| &self.bases[*index])
    }

    fn convert(&self, index: usize) -> Result<Glyph, AuthoredReadError> {
        self.glyphs
            .glyph(index)
            .map_err(|source| BackendError::load(self.format, self.path.clone(), source).into())
    }
}

/// A source's top-level data and its glyphs, from the format's import
/// stream.
struct AuthoredStream {
    header: Font,
    glyphs: Box<dyn AuthoredGlyphs>,
    report: ImportReport,
}

impl AuthoredStream {
    /// Opens `path`'s stream when `format` is an authored format; `None` for
    /// any other format.
    fn open(format: FontFormat, path: &str) -> FormatBackendResult<Option<Self>> {
        let opened = match format {
            FontFormat::Ufo => {
                let (header, stream, report) = crate::formats::ufo::stream_font(path)?;
                Self::new(header, stream, report)
            }
            FontFormat::Designspace => {
                let (header, stream, report) = crate::formats::designspace::stream_font(path)?;
                Self::new(header, stream, report)
            }
            FontFormat::Glyphs => {
                let (header, stream, report) = crate::formats::glyphs::stream_font(path)?;
                let glyphs = crate::formats::glyphs::GlyphsAuthoredGlyphs::new(stream);
                Self::new(header, glyphs, report)
            }
            FontFormat::Shift | FontFormat::Ttf | FontFormat::Otf => return Ok(None),
        };
        Ok(Some(opened))
    }

    fn new(header: Font, glyphs: impl AuthoredGlyphs + 'static, report: ImportReport) -> Self {
        Self {
            header,
            glyphs: Box::new(glyphs),
            report,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use shift_font::test_support::fixtures;

    use super::*;
    use crate::font_loader::FontLoader;

    fn open(path: &Path) -> OpenedAuthoredSource {
        AuthoredSource::open(path.to_str().unwrap()).unwrap()
    }

    fn import(path: &Path) -> Font {
        FontLoader::new().read_font(path.to_str().unwrap()).unwrap()
    }

    /// Every glyph read alone is the glyph a full import produces, ids and
    /// all; the directory lists import's sources and axes, and its glyphs in
    /// import order, each layer a placeholder under its read's id, keeping
    /// its advance.
    fn assert_reads_as_imported(path: &Path) {
        let imported = import(path);
        let OpenedAuthoredSource { directory, source } = open(path);

        assert_eq!(directory.sources(), imported.sources());
        assert_eq!(directory.axes(), imported.axes());
        let order = |font: &Font| font.glyphs().map(Glyph::id).collect::<Vec<_>>();
        assert_eq!(order(&directory), order(&imported));
        for expected in imported.glyphs() {
            let read = source.glyph(expected.id()).unwrap();
            assert_eq!(&read, expected);

            let listed = directory.glyph(read.id()).unwrap();
            let advances = |glyph: &Glyph| {
                let layers = glyph.layers().values();
                layers
                    .map(|layer| (layer.id(), layer.width(), layer.height()))
                    .collect::<Vec<_>>()
            };
            assert_eq!(advances(listed), advances(&read));
            assert!(listed.layers().values().all(|layer| layer.is_empty()));
        }
    }

    /// Two imports of one file give every source, axis, layer and entity in
    /// a layer the same id.
    fn assert_imports_alike(path: &Path) {
        let (first, second) = (import(path), import(path));

        assert_eq!(first.sources(), second.sources());
        assert_eq!(first.axes(), second.axes());
        assert!(first.glyphs().eq(second.glyphs()));
    }

    #[test]
    fn every_import_of_a_file_names_its_entities_alike() {
        assert_imports_alike(&fixtures::mutatorsans_ufo());
        assert_imports_alike(&fixtures::mutatorsans_designspace());
        assert_imports_alike(&fixtures::font("MutatorSansVariable.glyphs"));
    }

    #[test]
    fn a_ufo_glyph_read_alone_is_the_imported_glyph() {
        assert_reads_as_imported(&fixtures::mutatorsans_ufo());
    }

    #[test]
    fn a_designspace_glyph_read_alone_is_the_imported_glyph() {
        assert_reads_as_imported(&fixtures::mutatorsans_designspace());
    }

    #[test]
    fn a_glyphs_glyph_read_alone_is_the_imported_glyph() {
        assert_reads_as_imported(&fixtures::font("MutatorSansVariable.glyphs"));
        assert_reads_as_imported(&fixtures::font("AnchorPropagation.glyphs"));
    }

    #[test]
    fn layers_are_read_by_id_in_request_order() {
        let OpenedAuthoredSource { directory, source } = open(&fixtures::mutatorsans_designspace());
        let glyph = directory.glyph_by_name("A").unwrap();
        let mut layer_ids: Vec<LayerId> = glyph.layer_ids().collect();
        layer_ids.reverse();

        let layers = source.layers(&layer_ids).unwrap();

        assert_eq!(
            layers.iter().map(GlyphLayer::id).collect::<Vec<_>>(),
            layer_ids
        );
        let read = source.glyph(glyph.id()).unwrap();
        for layer in &layers {
            assert_eq!(Some(layer), read.layer(layer.id()));
        }
    }

    #[test]
    fn component_queries_match_the_imported_components() {
        let path = fixtures::mutatorsans_designspace();
        let imported = import(&path);
        let OpenedAuthoredSource { source, .. } = open(&path);
        let glyph_ids: Vec<GlyphId> = imported.glyphs().map(Glyph::id).collect();
        let direct = |glyph: &Glyph| glyph.component_glyph_ids().collect::<BTreeSet<_>>();

        let expected: Vec<Vec<GlyphId>> = imported
            .glyphs()
            .map(|glyph| direct(glyph).into_iter().collect())
            .collect();
        assert_eq!(source.component_bases(&glyph_ids), expected);

        let aacute = imported.glyph_by_name("Aacute").unwrap().id();
        let bases: BTreeSet<GlyphId> = source.bases_of(&[aacute]).into_iter().collect();
        assert_eq!(bases, direct(imported.glyph(aacute).unwrap()));

        let acute = imported.glyph_by_name("acute").unwrap().id();
        let users: Vec<GlyphId> = imported
            .glyphs()
            .filter(|glyph| direct(glyph).contains(&acute))
            .map(Glyph::id)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        assert!(!users.is_empty());
        assert_eq!(source.composites_of(&[acute]), users);
    }

    #[test]
    fn bases_of_follows_components_transitively_without_the_roots() {
        let path = fixtures::font("AnchorPropagation.glyphs");
        let imported = import(&path);
        let OpenedAuthoredSource { source, .. } = open(&path);

        for glyph in imported.glyphs() {
            let mut closure = BTreeSet::new();
            let mut pending: Vec<GlyphId> = glyph.component_glyph_ids().collect();
            while let Some(base) = pending.pop() {
                if base != glyph.id() && closure.insert(base) {
                    pending.extend(imported.glyph(base).unwrap().component_glyph_ids());
                }
            }
            let bases: BTreeSet<GlyphId> = source.bases_of(&[glyph.id()]).into_iter().collect();
            assert_eq!(bases, closure, "{}", glyph.name());
        }
    }

    #[test]
    fn attaching_layers_are_those_whose_imported_anchors_marks_attach_to() {
        let path = fixtures::font("AnchorPropagation.glyphs");
        let imported = import(&path);
        let OpenedAuthoredSource { directory, source } = open(&path);
        let expected: Vec<LayerId> = imported
            .glyphs()
            .flat_map(|glyph| glyph.layers().values())
            .filter(|layer| layer.anchors_iter().any(shift_font::Anchor::attaches_marks))
            .map(|layer| layer.id())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let all: Vec<LayerId> = directory.layer_ids().collect();

        let read = source.attaching_anchor_layers(&all);

        assert!(!read.is_empty());
        assert_eq!(read, expected);
    }

    #[test]
    fn ids_the_source_lacks_are_rejected_or_answer_nothing() {
        let OpenedAuthoredSource { source, .. } = open(&fixtures::mutatorsans_ufo());
        let glyph = GlyphId::new();
        let layer = LayerId::new();

        assert!(matches!(
            source.glyph(glyph),
            Err(AuthoredReadError::Missing(CoreError::GlyphNotFound(missing))) if missing == glyph
        ));
        assert!(matches!(
            source.layers(&[layer]),
            Err(AuthoredReadError::Missing(CoreError::LayerNotFound(missing))) if missing == layer
        ));
        assert_eq!(
            source.component_bases(&[glyph]),
            vec![Vec::<GlyphId>::new()]
        );
        assert!(source.bases_of(&[glyph]).is_empty());
        assert!(source.composites_of(&[glyph]).is_empty());
        assert!(source.attaching_anchor_layers(&[layer]).is_empty());
    }

    fn copy_directory(source: &Path, target: &Path) {
        std::fs::create_dir_all(target).unwrap();
        for entry in std::fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let destination = target.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_directory(&entry.path(), &destination);
            } else {
                std::fs::copy(entry.path(), destination).unwrap();
            }
        }
    }

    fn assert_refuses_missing_base(path: &Path) {
        let message = |error: BackendError| std::error::Error::source(&error).unwrap().to_string();
        let opened = AuthoredSource::open(path.to_str().unwrap()).err().unwrap();
        let imported = FontLoader::new()
            .read_font(path.to_str().unwrap())
            .unwrap_err();

        assert!(message(opened).contains(r#"component base glyph "missing" does not exist"#));
        assert_eq!(
            message(imported),
            message(AuthoredSource::open(path.to_str().unwrap()).err().unwrap())
        );
    }

    #[test]
    fn a_ufo_component_whose_base_is_missing_fails_as_import_does() {
        let temporary = tempfile::tempdir().unwrap();
        let ufo = temporary.path().join("Missing.ufo");
        copy_directory(&fixtures::mutatorsans_ufo(), &ufo);
        let glif = ufo.join("glyphs/A_acute.glif");
        let text = std::fs::read_to_string(&glif).unwrap();
        std::fs::write(&glif, text.replace(r#"base="A""#, r#"base="missing""#)).unwrap();

        assert_refuses_missing_base(&ufo);
    }

    #[test]
    fn a_glyphs_component_whose_base_is_missing_fails_as_import_does() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("Missing.glyphs");
        let source = std::fs::read_to_string(fixtures::font("ScaledComponent.glyphs")).unwrap();
        std::fs::write(&path, source.replace("ref = period;", "ref = missing;")).unwrap();

        assert_refuses_missing_base(&path);
    }

    #[test]
    fn the_source_keeps_the_report_import_gives() {
        let path = fixtures::font("MultiFamily.glyphs");
        let import = FontLoader::new()
            .stream_font(path.to_str().unwrap())
            .unwrap();

        let OpenedAuthoredSource { source, .. } = open(&path);

        assert!(!import.report().losses.is_empty());
        assert_eq!(source.report(), import.report());
    }

    #[test]
    fn a_compiled_font_is_no_authored_source() {
        let opened = AuthoredSource::open(fixtures::mutatorsans_ttf().to_str().unwrap());

        assert!(matches!(
            opened,
            Err(BackendError::AuthoredUnsupported {
                format: FontFormat::Ttf
            })
        ));
    }
}
