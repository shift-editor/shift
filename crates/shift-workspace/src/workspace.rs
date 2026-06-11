use std::path::{Path, PathBuf};

use shift_backends::{FontExportRequest, FontExportResult, FontExporter, font_loader::FontLoader};
use shift_font::{
    AppliedIntents, BooleanOp, BulkNodePositionUpdates, ContourId, FontChange, FontChangeSet,
    FontIntentSet, Glyph, GlyphId, GlyphLayer, GlyphName, LayerId, PointId, PointPosition,
    PointType, SourceId, TouchedLayer, error::CoreError,
};
use shift_source::ShiftSourcePackage;
use shift_store::ShiftStore;

use crate::NewWorkspace;
use crate::ledger::{LayerPair, Ledger, LedgerEntry};

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
    Untitled,
    Package { path: PathBuf },
    Imported { original_path: PathBuf },
}

pub struct FontWorkspace {
    font: shift_font::Font,
    source: WorkspaceSource,
    store: ShiftStore,
    ledger: Ledger,
}

impl FontWorkspace {
    pub fn create_untitled(
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let mut store = ShiftStore::open(store_path)?;
        store.set_font_info(new_workspace.font_info())?;

        let font = new_font(new_workspace);
        store.replace_font_state(&font)?;

        Ok(Self {
            font,
            source: WorkspaceSource::Untitled,
            store,
            ledger: Ledger::default(),
        })
    }

    pub fn create_package(
        source_path: impl AsRef<Path>,
        store_path: impl AsRef<Path>,
        new_workspace: NewWorkspace,
    ) -> Result<Self, WorkspaceError> {
        let source_package = ShiftSourcePackage::create_empty(source_path)?;
        let mut workspace = Self::create_untitled(store_path, new_workspace)?;

        workspace.source = WorkspaceSource::Package {
            path: source_package.path().to_path_buf(),
        };

        Ok(workspace)
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
            WorkspaceSource::Untitled | WorkspaceSource::Imported { .. } => {
                Err(WorkspaceError::NeedsSaveAs)
            }
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
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;

            layer.set_x_advance(width);
            let edited_layer = layer.clone();
            let change_set = FontChange::layer_metrics_changed(layer).into();

            Ok((edited_layer, change_set))
        })
    }

    pub fn translate_layer(
        &mut self,
        layer_id: LayerId,
        dx: f64,
        dy: f64,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.replace_layer_geometry(layer_id, |layer| {
            layer.translate_layer(dx, dy);
            Ok(())
        })
    }

    pub fn add_point(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) -> Result<(GlyphLayer, PointId), WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let added = layer.add_point_to_contour(contour_id.clone(), x, y, point_type, smooth)?;
            let edited_layer = layer.clone();
            let change_set = FontChange::points_added(
                layer_id.clone(),
                &added.contour,
                vec![added.point_id.clone()],
            )
            .into();

            Ok(((edited_layer, added.point_id.clone()), change_set))
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
    ) -> Result<(GlyphLayer, PointId), WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let added =
                layer.insert_point_before(before_point_id.clone(), x, y, point_type, smooth)?;
            let edited_layer = layer.clone();
            let change_set = FontChange::points_added(
                layer_id.clone(),
                &added.contour,
                vec![added.point_id.clone()],
            )
            .into();

            Ok(((edited_layer, added.point_id.clone()), change_set))
        })
    }

    pub fn add_contour(
        &mut self,
        layer_id: LayerId,
    ) -> Result<(GlyphLayer, ContourId), WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let contour = layer.add_empty_contour();
            let edited_layer = layer.clone();
            let change_set = FontChange::contour_added(layer_id.clone(), &contour).into();

            Ok(((edited_layer, contour.id()), change_set))
        })
    }

    pub fn open_contour(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.set_contour_closed(layer_id, contour_id, false)
    }

    pub fn close_contour(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.set_contour_closed(layer_id, contour_id, true)
    }

    pub fn reverse_contour(
        &mut self,
        layer_id: LayerId,
        contour_id: ContourId,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.replace_layer_geometry(layer_id, |layer| {
            layer.reverse_contour(contour_id)?;
            Ok(())
        })
    }

    pub fn apply_boolean_op(
        &mut self,
        layer_id: LayerId,
        contour_id_a: ContourId,
        contour_id_b: ContourId,
        operation: BooleanOp,
    ) -> Result<(GlyphLayer, Vec<ContourId>), WorkspaceError> {
        self.replace_layer_geometry_with_result(layer_id, |layer| {
            layer.apply_boolean_op(contour_id_a, contour_id_b, operation)
        })
    }

    pub fn remove_points(
        &mut self,
        layer_id: LayerId,
        point_ids: Vec<PointId>,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.replace_layer_geometry(layer_id, |layer| {
            layer.remove_points(&point_ids)?;
            Ok(())
        })
    }

    pub fn toggle_smooth(
        &mut self,
        layer_id: LayerId,
        point_id: PointId,
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            let smooth = layer.toggle_smooth(point_id.clone())?;
            let edited_layer = layer.clone();
            let change_set =
                FontChange::point_smooth_changed(layer_id.clone(), point_id.clone(), smooth).into();

            Ok((edited_layer, change_set))
        })
    }

    /// Applies a renderer intent set: validate + mutate via shift-font,
    /// persist the canonical records, swap the live font, record one ledger
    /// entry. One call = one SQLite transaction = one undo step.
    pub fn apply(
        &mut self,
        set: FontIntentSet,
        label: Option<String>,
    ) -> Result<AppliedIntents, WorkspaceError> {
        let mut pre: Vec<GlyphLayer> = Vec::new();
        for intent in &set.intents {
            let layer_id = intent.layer_id();
            if pre.iter().any(|layer| layer.id() == *layer_id) {
                continue;
            }
            if let Some(layer) = self.font.layer(layer_id.clone()) {
                pre.push(layer.clone());
            }
        }

        let outcome = self.commit_edit(|font| {
            let outcome = font.apply_intents(set)?;
            let changes = outcome.changes.clone();
            Ok((outcome, changes))
        })?;

        let layers = outcome
            .layers
            .iter()
            .filter_map(|touched| {
                let post = touched.layer.clone();
                pre.iter()
                    .find(|layer| layer.id() == post.id())
                    .map(|pre_layer| LayerPair {
                        pre: pre_layer.clone(),
                        post,
                    })
            })
            .collect();

        self.ledger.push(LedgerEntry { label, layers });
        Ok(outcome)
    }

    /// Replays the most recent entry's pre states. `None` when the undo
    /// stack is empty. The echo is the same replace-grade shape as `apply`.
    pub fn undo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_undo() else {
            return Ok(None);
        };

        let outcome = self.replay(&entry, |pair| &pair.pre)?;
        self.ledger.record_undone(entry);
        Ok(Some(outcome))
    }

    /// Replays the most recent undone entry's post states.
    pub fn redo(&mut self) -> Result<Option<AppliedIntents>, WorkspaceError> {
        let Some(entry) = self.ledger.pop_redo() else {
            return Ok(None);
        };

        let outcome = self.replay(&entry, |pair| &pair.post)?;
        self.ledger.record_redone(entry);
        Ok(Some(outcome))
    }

    fn replay(
        &mut self,
        entry: &LedgerEntry,
        side: impl Fn(&LayerPair) -> &GlyphLayer,
    ) -> Result<AppliedIntents, WorkspaceError> {
        let restored: Vec<GlyphLayer> =
            entry.layers.iter().map(|pair| side(pair).clone()).collect();

        self.commit_edit(move |font| {
            let mut changes = FontChangeSet::default();
            let mut layers = Vec::with_capacity(restored.len());

            for replacement in restored {
                let layer_id = replacement.id();
                let layer = font
                    .layer_mut(layer_id.clone())
                    .ok_or(CoreError::LayerNotFound(layer_id))?;
                *layer = replacement;

                // Geometry replace persists contours only; metrics ride their
                // own change so width/height restores reach SQLite too.
                changes.push(FontChange::layer_geometry_replaced(layer));
                changes.push(FontChange::layer_metrics_changed(layer));
                layers.push(TouchedLayer {
                    layer: layer.clone(),
                    structural: true,
                });
            }

            let outcome = AppliedIntents {
                changes: changes.clone(),
                layers,
            };
            Ok((outcome, changes))
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
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.replace_layer_geometry(layer_id, |layer| {
            *layer = replacement;
            Ok(())
        })
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
    ) -> Result<GlyphLayer, WorkspaceError> {
        self.commit_edit(|font| {
            let layer = font
                .layer_mut(layer_id.clone())
                .ok_or(CoreError::LayerNotFound(layer_id.clone()))?;
            if closed {
                layer.close_contour(contour_id.clone())?;
            } else {
                layer.open_contour(contour_id.clone())?;
            }
            let edited_layer = layer.clone();
            let change_set = FontChange::contour_open_closed_changed(
                layer_id.clone(),
                contour_id.clone(),
                closed,
            )
            .into();

            Ok((edited_layer, change_set))
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
            ledger: Ledger::default(),
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
            ledger: Ledger::default(),
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
            WorkspaceSource::Untitled => None,
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

fn new_font(new_workspace: NewWorkspace) -> shift_font::Font {
    let mut font = shift_font::Font::new();
    font.metadata_mut().family_name = Some(new_workspace.family_name);
    font.metrics_mut().units_per_em = new_workspace.units_per_em as f64;
    font
}
