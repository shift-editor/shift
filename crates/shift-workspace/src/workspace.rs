use std::path::Path;

use shift_source::ShiftSourcePackage;
use shift_store::ShiftStore;

use crate::NewWorkspace;

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("source package error")]
    Source(#[from] shift_source::SourcePackageError),

    #[error("store error")]
    Store(#[from] shift_store::StoreError),
}

pub struct FontWorkspace {
    font: shift_font::Font,
    source_package: ShiftSourcePackage,
    store: ShiftStore,
}

impl FontWorkspace {
    pub fn create_new(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let source_package = ShiftSourcePackage::create_empty(source_path)?;
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(new_workspace.font_info())?;

        Ok(Self {
            font: shift_font::Font::new(),
            source_package,
            store,
        })
    }

    pub fn open(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
    ) -> Result<Self, WorkspaceError> {
        let source_package = ShiftSourcePackage::open(source_path)?;
        let store = ShiftStore::open(store_path)?;

        Ok(Self {
            font: shift_font::Font::new(),
            source_package,
            store,
        })
    }

    pub fn font(&self) -> &shift_font::Font {
        &self.font
    }

    pub fn source_package(&self) -> &ShiftSourcePackage {
        &self.source_package
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
