use std::path::{Path, PathBuf};

use shift_backends::{FontExportRequest, FontExportResult, FontExporter, font_loader::FontLoader};
use shift_font::{
    FontChange, FontChangeSet, Glyph, GlyphCreated, GlyphLayer, GlyphLayerChangeTarget, LayerId,
    SourceId, error::CoreError,
};
use shift_source::ShiftSourcePackage;
use shift_store::ShiftStore;

use crate::NewWorkspace;

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("invalid {kind}: {value}")]
    InvalidInput { kind: &'static str, value: String },

    #[error(transparent)]
    Font(#[from] CoreError),

    #[error("source package error")]
    Source(#[from] shift_source::SourcePackageError),

    #[error("store error")]
    Store(#[from] shift_store::StoreError),

    #[error("font backend error")]
    Backend(#[from] shift_backends::BackendError),

    #[error("font export error")]
    Export(#[from] shift_backends::ExportError),

    #[error("workspace needs a save path")]
    NeedsSaveAs,

    #[error("invalid UTF-8 in workspace path: {0}")]
    InvalidPathUtf8(PathBuf),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkspaceSource {
    Package { path: PathBuf },
    Imported { original_path: PathBuf },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlyphLayerTarget {
    pub glyph_name: String,
    pub unicode: Option<u32>,
    pub source_id: SourceId,
    pub layer_id: LayerId,
}

pub struct FontWorkspace {
    font: shift_font::Font,
    source: WorkspaceSource,
    store: ShiftStore,
}

impl FontWorkspace {
    pub fn create(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let source_package = ShiftSourcePackage::create_empty(source_path)?;
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(new_workspace.font_info())?;

        let mut font = shift_font::Font::new();
        font.metadata_mut().family_name = Some(new_workspace.family_name);
        font.metrics_mut().units_per_em = new_workspace.units_per_em as f64;
        store.replace_font_state(&font)?;

        Ok(Self {
            font,
            source: WorkspaceSource::Package {
                path: source_package.path().to_path_buf(),
            },
            store,
        })
    }

    pub fn open(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let source_path = source_path.as_ref();
        if ShiftSourcePackage::is_package_path(source_path) {
            Self::open_package(source_path, store_path)
        } else {
            Self::import_font(source_path, store_path)
        }
    }

    pub fn save(&mut self) -> Result<(), WorkspaceError> {
        match &self.source {
            WorkspaceSource::Package { path } => {
                ShiftSourcePackage::open(path)?;
                Ok(())
            }
            WorkspaceSource::Imported { .. } => Err(WorkspaceError::NeedsSaveAs),
        }
    }

    pub fn save_as(&mut self, source_path: impl AsRef<Path>) -> Result<(), WorkspaceError> {
        let source_package = ShiftSourcePackage::create_empty(source_path)?;
        self.source = WorkspaceSource::Package {
            path: source_package.path().to_path_buf(),
        };

        Ok(())
    }

    pub fn export(&self, request: FontExportRequest) -> Result<FontExportResult, WorkspaceError> {
        FontExporter::new()
            .export(&self.font, request)
            .map_err(WorkspaceError::from)
    }

    pub fn update_glyph_identity(
        &mut self,
        from_name: &str,
        name: String,
        unicodes: Vec<u32>,
    ) -> Result<(), WorkspaceError> {
        let name = name.trim();
        let mut next_font = self.font.clone();

        let glyph_id =
            next_font
                .glyph_id_by_name(from_name)
                .ok_or_else(|| WorkspaceError::InvalidInput {
                    kind: "glyph name",
                    value: from_name.to_string(),
                })?;
        let existing = next_font
            .glyph(glyph_id)
            .ok_or_else(|| WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: from_name.to_string(),
            })?;
        if from_name == name && existing.unicodes() == unicodes.as_slice() {
            return Ok(());
        }

        if name.is_empty() {
            return Err(WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: name.to_string(),
            });
        }

        if from_name != name && next_font.glyph_id_by_name(name).is_some() {
            return Err(WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: format!("{name} already exists"),
            });
        }

        let glyph = next_font
            .glyph(glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        let from_name = glyph.glyph_name().clone();
        let from_unicodes = glyph.unicodes().to_vec();
        let glyph_name = shift_font::GlyphName::new(name.to_string()).map_err(|_| {
            WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: name.to_string(),
            }
        })?;

        next_font.rename_glyph(glyph_id, glyph_name)?;
        next_font.set_glyph_unicodes(glyph_id, unicodes)?;
        let glyph = next_font
            .glyph(glyph_id)
            .ok_or(CoreError::GlyphNotFound(glyph_id))?;
        let to_name = glyph.glyph_name().clone();
        let to_unicodes = glyph.unicodes().to_vec();

        self.commit_font(
            next_font,
            FontChangeSet::new(vec![FontChange::GlyphIdentityChanged(
                shift_font::GlyphIdentityChanged {
                    glyph_id,
                    from_name,
                    to_name,
                    from_unicodes,
                    to_unicodes,
                },
            )]),
        )?;
        Ok(())
    }

    pub fn edit_glyph_layer<R>(
        &mut self,
        target: GlyphLayerTarget,
        edit: impl FnOnce(&mut GlyphLayer) -> Result<R, CoreError>,
        changes: impl FnOnce(&GlyphLayerChangeTarget, &GlyphLayer, &R) -> FontChangeSet,
    ) -> Result<R, WorkspaceError> {
        let mut next_font = self.font.clone();
        let mut change_set = FontChangeSet::default();

        if next_font.glyph_id_by_name(&target.glyph_name).is_none() {
            let mut glyph = Glyph::new(target.glyph_name.clone());
            if let Some(unicode) = target.unicode {
                glyph.add_unicode(unicode);
            }
            glyph.set_layer(GlyphLayer::with_width(
                target.layer_id,
                target.source_id,
                500.0,
            ));
            change_set.push(FontChange::GlyphCreated(GlyphCreated::from(&glyph)));
            next_font.insert_glyph(glyph)?;
        }

        if !next_font
            .sources()
            .iter()
            .any(|source| source.id() == target.source_id)
        {
            return Err(WorkspaceError::InvalidInput {
                kind: "source ID",
                value: target.source_id.to_string(),
            });
        }

        let glyph_id = next_font
            .glyph_id_by_name(&target.glyph_name)
            .ok_or_else(|| WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: target.glyph_name.clone(),
            })?;

        if next_font.layer(target.layer_id).is_none() {
            next_font.insert_glyph_layer(
                glyph_id,
                GlyphLayer::with_width(target.layer_id, target.source_id, 500.0),
            )?;
        }

        let glyph = next_font
            .glyph(glyph_id)
            .ok_or_else(|| WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: target.glyph_name.clone(),
            })?;
        let change_target = GlyphLayerChangeTarget {
            glyph_id: glyph.id(),
            glyph_name: glyph.glyph_name().clone(),
            source_id: target.source_id,
            layer_id: target.layer_id,
        };

        if let Some(unicode) = target.unicode
            && !glyph.unicodes().contains(&unicode)
        {
            let mut unicodes = glyph.unicodes().to_vec();
            unicodes.push(unicode);
            next_font.set_glyph_unicodes(glyph_id, unicodes)?;
        }

        let layer =
            next_font
                .layer_mut(target.layer_id)
                .ok_or_else(|| WorkspaceError::InvalidInput {
                    kind: "layer ID",
                    value: target.layer_id.to_string(),
                })?;
        let result = edit(layer)?;
        let layer_changes = changes(&change_target, layer, &result);
        change_set.changes.extend(layer_changes.changes);

        self.commit_font(next_font, change_set)?;

        Ok(result)
    }

    fn commit_font(
        &mut self,
        next_font: shift_font::Font,
        change_set: FontChangeSet,
    ) -> Result<(), WorkspaceError> {
        self.store.apply_change_set(&change_set)?;
        self.font = next_font;
        Ok(())
    }

    fn open_package(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let source_package = ShiftSourcePackage::open(source_path)?;
        let mut store = ShiftStore::open(store_path)?;
        let font = shift_font::Font::new();
        store.replace_font_state(&font)?;

        Ok(Self {
            font,
            source: WorkspaceSource::Package {
                path: source_package.path().to_path_buf(),
            },
            store,
        })
    }

    fn import_font(
        import_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let import_path = import_path.as_ref();
        let import_path_str = import_path
            .to_str()
            .ok_or_else(|| WorkspaceError::InvalidPathUtf8(import_path.to_path_buf()))?;
        let font = FontLoader::new().read_font(import_path_str)?;
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(font_info_from_font(&font))?;
        store.replace_font_state(&font)?;

        Ok(Self {
            font,
            source: WorkspaceSource::Imported {
                original_path: import_path.to_path_buf(),
            },
            store,
        })
    }

    pub fn font(&self) -> &shift_font::Font {
        &self.font
    }

    pub fn source(&self) -> &WorkspaceSource {
        &self.source
    }

    pub fn save_target(&self) -> Option<&Path> {
        match &self.source {
            WorkspaceSource::Package { path } => Some(path),
            WorkspaceSource::Imported { .. } => None,
        }
    }

    pub fn store(&self) -> &ShiftStore {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut ShiftStore {
        &mut self.store
    }

    pub fn font_info(&self) -> Result<Option<shift_store::FontInfo>, WorkspaceError> {
        self.store.get_font_info().map_err(WorkspaceError::from)
    }
}

fn font_info_from_font(font: &shift_font::Font) -> shift_store::FontInfo {
    let metadata = font.metadata();
    shift_store::FontInfo {
        family_name: metadata.family_name.clone(),
        copyright: metadata.copyright.clone(),
        trademark: metadata.trademark.clone(),
        description: metadata.description.clone(),
        sample_text: None,
        designer: metadata.designer.clone(),
        designer_url: metadata.designer_url.clone(),
        manufacturer: metadata.manufacturer.clone(),
        manufacturer_url: metadata.manufacturer_url.clone(),
        license_description: metadata.license.clone(),
        license_info_url: metadata.license_url.clone(),
        vendor_id: None,
        version_major: metadata.version_major.map(i64::from),
        version_minor: metadata.version_minor.map(i64::from),
        units_per_em: font.metrics().units_per_em as i64,
    }
}
