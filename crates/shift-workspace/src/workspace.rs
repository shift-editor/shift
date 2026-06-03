use std::path::{Path, PathBuf};

use shift_backends::{FontExportRequest, FontExportResult, FontExporter, font_loader::FontLoader};
use shift_source::ShiftSourcePackage;
use shift_store::ShiftStore;

use crate::NewWorkspace;

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
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

    fn open_package(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let source_package = ShiftSourcePackage::open(source_path)?;
        let store = ShiftStore::open(store_path)?;

        Ok(Self {
            font: shift_font::Font::new(),
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
