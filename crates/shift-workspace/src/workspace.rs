use std::path::{Path, PathBuf};

use shift_backends::{FontExportRequest, FontExportResult, FontExporter, font_loader::FontLoader};
use shift_font::{
    AnchorId, BooleanOp, BulkNodePositionUpdates, ComponentId, ContourId, FontChange,
    FontChangeSet, Glyph, GlyphId, GlyphLayer, GlyphName, GuidelineId, LayerId, PointId,
    PointPosition, PointType, SourceId, error::CoreError,
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

pub struct FontWorkspace {
    font: shift_font::Font,
    source: WorkspaceSource,
    store: ShiftStore,
}

#[derive(Clone, Debug)]
pub struct GlyphValueEdit {
    pub layer: GlyphLayer,
    pub changed: GlyphEditEntities,
}

impl GlyphValueEdit {
    fn new(layer: &GlyphLayer, changed: GlyphEditEntities) -> Self {
        Self {
            layer: layer.clone(),
            changed,
        }
    }
}

#[derive(Clone, Debug)]
pub struct GlyphStructureEdit {
    pub layer: GlyphLayer,
    pub changed: GlyphEditEntities,
}

impl GlyphStructureEdit {
    fn new(layer: &GlyphLayer, changed: GlyphEditEntities) -> Self {
        Self {
            layer: layer.clone(),
            changed,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct GlyphEditEntities {
    pub point_ids: Vec<PointId>,
    pub contour_ids: Vec<ContourId>,
    pub anchor_ids: Vec<AnchorId>,
    pub guideline_ids: Vec<GuidelineId>,
    pub component_ids: Vec<ComponentId>,
}

impl GlyphEditEntities {
    fn point(id: PointId) -> Self {
        Self {
            point_ids: vec![id],
            ..Default::default()
        }
    }

    fn points(ids: Vec<PointId>) -> Self {
        Self {
            point_ids: ids,
            ..Default::default()
        }
    }

    fn contour(id: ContourId) -> Self {
        Self {
            contour_ids: vec![id],
            ..Default::default()
        }
    }

    fn contours(ids: Vec<ContourId>) -> Self {
        Self {
            contour_ids: ids,
            ..Default::default()
        }
    }
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
        let existing =
            next_font
                .glyph(glyph_id.clone())
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
            .glyph(glyph_id.clone())
            .ok_or(CoreError::GlyphNotFound(glyph_id.clone()))?;
        let from_name = glyph.glyph_name().clone();
        let from_unicodes = glyph.unicodes().to_vec();
        let glyph_name = shift_font::GlyphName::new(name.to_string()).map_err(|_| {
            WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: name.to_string(),
            }
        })?;

        next_font.rename_glyph(glyph_id.clone(), glyph_name)?;
        next_font.set_glyph_unicodes(glyph_id.clone(), unicodes)?;
        let glyph = next_font
            .glyph(glyph_id.clone())
            .ok_or(CoreError::GlyphNotFound(glyph_id.clone()))?;
        let to_name = glyph.glyph_name().clone();
        let to_unicodes = glyph.unicodes().to_vec();

        self.commit_font(
            next_font,
            FontChange::glyph_identity_changed(
                glyph_id.clone(),
                from_name,
                to_name,
                from_unicodes,
                to_unicodes,
            )
            .into(),
        )?;
        Ok(())
    }

    pub fn create_glyph(
        &mut self,
        name: String,
        unicodes: Vec<u32>,
    ) -> Result<Glyph, WorkspaceError> {
        self.commit_edit(|font| {
            let name = name.trim();
            if name.is_empty() {
                return Err(WorkspaceError::InvalidInput {
                    kind: "glyph name",
                    value: name.to_string(),
                });
            }
            if font.glyph_id_by_name(name).is_some() {
                return Err(WorkspaceError::InvalidInput {
                    kind: "glyph name",
                    value: format!("{name} already exists"),
                });
            }

            let glyph_name =
                GlyphName::new(name.to_string()).map_err(|_| WorkspaceError::InvalidInput {
                    kind: "glyph name",
                    value: name.to_string(),
                })?;
            let mut glyph = Glyph::new(glyph_name);
            glyph.set_unicodes(unicodes);
            let created_glyph = glyph.clone();
            let change_set = FontChange::glyph_created(&glyph).into();

            font.insert_glyph(glyph)?;

            Ok((created_glyph, change_set))
        })
    }

    pub fn create_glyph_layer(
        &mut self,
        glyph_id: GlyphId,
        source_id: SourceId,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.commit_edit(|font| {
            let glyph = font
                .glyph(glyph_id.clone())
                .ok_or(CoreError::GlyphNotFound(glyph_id.clone()))?;
            let glyph_name = glyph.glyph_name().clone();
            let layer = GlyphLayer::with_width(LayerId::new(), source_id.clone(), 500.0);
            let layer_id = layer.id();

            font.insert_glyph_layer(glyph_id.clone(), layer)?;
            let layer = font
                .layer(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?
                .clone();
            let change_set =
                FontChange::glyph_layer_created(glyph_id.clone(), Some(glyph_name), &layer).into();

            Ok((layer, change_set))
        })
    }

    pub fn set_x_advance(
        &mut self,
        layer_id: LayerId,
        width: f64,
    ) -> Result<GlyphValueEdit, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;

            layer.set_x_advance(width);
            let edit_change = GlyphValueEdit::new(layer, Default::default());
            let change_set = FontChange::layer_metrics_changed(layer).into();

            Ok((edit_change, change_set))
        })
    }

    pub fn translate_layer(
        &mut self,
        layer_id: LayerId,
        dx: f64,
        dy: f64,
    ) -> Result<GlyphValueEdit, WorkspaceError> {
        let layer = self.replace_layer_geometry(layer_id, |layer| {
            layer.translate_layer(dx, dy);
            Ok(())
        })?;

        Ok(GlyphValueEdit::new(&layer, Default::default()))
    }

    pub fn add_point(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let added = layer.add_point_to_contour(contour_id.clone(), x, y, point_type, smooth)?;
            let edit_change =
                GlyphStructureEdit::new(layer, GlyphEditEntities::point(added.point_id.clone()));
            let change_set = FontChange::points_added(
                layer_id.clone(),
                &added.contour,
                vec![added.point_id.clone()],
            )
            .into();

            Ok((edit_change, change_set))
        })
    }

    pub fn insert_point_before(
        &mut self,
        layer_id: LayerId,
        before_point_id: PointId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let added =
                layer.insert_point_before(before_point_id.clone(), x, y, point_type, smooth)?;
            let edit_change =
                GlyphStructureEdit::new(layer, GlyphEditEntities::point(added.point_id.clone()));
            let change_set = FontChange::points_added(
                layer_id.clone(),
                &added.contour,
                vec![added.point_id.clone()],
            )
            .into();

            Ok((edit_change, change_set))
        })
    }

    pub fn add_contour(&mut self, layer_id: LayerId) -> Result<GlyphStructureEdit, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let contour = layer.add_empty_contour();
            let edit_change =
                GlyphStructureEdit::new(layer, GlyphEditEntities::contour(contour.id()));
            let change_set = FontChange::contour_added(layer_id.clone(), &contour).into();

            Ok((edit_change, change_set))
        })
    }

    pub fn open_contour(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        self.set_contour_closed(layer_id, contour_id, false)
    }

    pub fn close_contour(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        self.set_contour_closed(layer_id, contour_id, true)
    }

    pub fn reverse_contour(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        let contour_id_for_change = contour_id.clone();
        let layer = self.replace_layer_geometry(layer_id, |layer| {
            layer.reverse_contour(contour_id)?;
            Ok(())
        })?;

        Ok(GlyphStructureEdit::new(
            &layer,
            GlyphEditEntities::contour(contour_id_for_change),
        ))
    }

    pub fn apply_boolean_op(
        &mut self,
        layer_id: LayerId,
        contour_id_a: ContourId,
        contour_id_b: ContourId,
        operation: BooleanOp,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        let (layer, contour_ids) = self.replace_layer_geometry_with_result(layer_id, |layer| {
            layer.apply_boolean_op(contour_id_a, contour_id_b, operation)
        })?;

        Ok(GlyphStructureEdit::new(
            &layer,
            GlyphEditEntities::contours(contour_ids),
        ))
    }

    pub fn remove_points(
        &mut self,
        layer_id: LayerId,
        point_ids: Vec<PointId>,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        let point_ids_for_change = point_ids.clone();
        let layer = self.replace_layer_geometry(layer_id, |layer| {
            layer.remove_points(&point_ids)?;
            Ok(())
        })?;

        Ok(GlyphStructureEdit::new(
            &layer,
            GlyphEditEntities::points(point_ids_for_change),
        ))
    }

    pub fn toggle_smooth(
        &mut self,
        layer_id: LayerId,
        point_id: PointId,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let smooth = layer.toggle_smooth(point_id.clone())?;
            let edit_change =
                GlyphStructureEdit::new(layer, GlyphEditEntities::point(point_id.clone()));
            let change_set =
                FontChange::point_smooth_changed(layer_id.clone(), point_id.clone(), smooth).into();

            Ok((edit_change, change_set))
        })
    }

    pub fn apply_position_patch(
        &mut self,
        layer_id: LayerId,
        updates: BulkNodePositionUpdates<'_>,
        point_position_changes: Vec<PointPosition>,
        replace_geometry: bool,
    ) -> Result<(), WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            layer.apply_bulk_node_positions(updates)?;
            let change_set = if replace_geometry {
                Self::layer_replaced_change_set(layer)
            } else {
                FontChange::point_positions_changed(
                    layer_id.clone(),
                    point_position_changes.clone(),
                )
                .into()
            };

            Ok(((), change_set))
        })
    }

    pub fn replace_layer(
        &mut self,
        layer_id: LayerId,
        replacement: GlyphLayer,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        let layer = self.replace_layer_geometry(layer_id, |layer| {
            *layer = replacement;
            Ok(())
        })?;

        Ok(GlyphStructureEdit::new(&layer, Default::default()))
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

    fn commit_edit<R, F>(&mut self, edit: F) -> Result<R, WorkspaceError>
    where
        F: FnOnce(&mut shift_font::Font) -> Result<(R, FontChangeSet), WorkspaceError>,
    {
        let mut next_font = self.font.clone();
        let (result, change_set) = edit(&mut next_font)?;
        self.commit_font(next_font, change_set)?;

        Ok(result)
    }

    fn set_contour_closed(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
        closed: bool,
    ) -> Result<GlyphStructureEdit, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            if closed {
                layer.close_contour(contour_id.clone())?;
            } else {
                layer.open_contour(contour_id.clone())?;
            }
            let edit_change =
                GlyphStructureEdit::new(layer, GlyphEditEntities::contour(contour_id.clone()));
            let change_set = FontChange::contour_open_closed_changed(
                layer_id.clone(),
                contour_id.clone(),
                closed,
            )
            .into();

            Ok((edit_change, change_set))
        })
    }

    fn replace_layer_geometry(
        &mut self,
        layer_id: LayerId,
        edit: impl FnOnce(&mut GlyphLayer) -> Result<(), CoreError>,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.replace_layer_geometry_with_result(layer_id, |layer| {
            edit(layer)?;
            Ok(())
        })
        .map(|(layer, ())| layer)
    }

    fn replace_layer_geometry_with_result<R>(
        &mut self,
        layer_id: LayerId,
        edit: impl FnOnce(&mut GlyphLayer) -> Result<R, CoreError>,
    ) -> Result<(GlyphLayer, R), WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let result = edit(layer)?;
            let edited_layer = layer.clone();
            let change_set = Self::layer_replaced_change_set(layer);

            Ok(((edited_layer, result), change_set))
        })
    }

    fn layer_replaced_change_set(layer: &GlyphLayer) -> FontChangeSet {
        FontChange::layer_geometry_replaced(layer).into()
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
