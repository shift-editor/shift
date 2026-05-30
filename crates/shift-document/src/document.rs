use std::path::Path;

use crate::{DocumentError, NewDocument};

pub struct ShiftDocument {
    font: shift_ir::Font,
    store: shift_store::ShiftStore,
}

impl ShiftDocument {
    pub fn create_new(
        path: impl AsRef<Path>,
        new_document: NewDocument,
    ) -> Result<Self, DocumentError> {
        let mut store = shift_store::ShiftStore::open(path)?;
        store.set_font_info(new_document.font_info())?;

        Ok(Self {
            font: shift_ir::Font::new(),
            store,
        })
    }

    pub fn from_parts(font: shift_ir::Font, store: shift_store::ShiftStore) -> Self {
        Self { font, store }
    }

    pub fn font(&self) -> &shift_ir::Font {
        &self.font
    }

    pub fn store(&self) -> &shift_store::ShiftStore {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut shift_store::ShiftStore {
        &mut self.store
    }

    pub fn font_info(&self) -> Result<Option<shift_store::FontInfo>, DocumentError> {
        self.store.get_font_info().map_err(DocumentError::from)
    }
}
