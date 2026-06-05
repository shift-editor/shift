use std::path::{Path, PathBuf};

use shift_backends::{FontExportRequest, FontExportResult, FontExporter, font_loader::FontLoader};
use shift_font::{
    BooleanOp, BulkNodePositionUpdates, ContourId, FontChange, FontChangeSet, Glyph,
    GlyphChangedEntities, GlyphCreated, GlyphLayer, GlyphLayerChangeTarget, GlyphStructure,
    GlyphStructureChange, GlyphValueChange, LayerId, PointId, PointPosition, PointType, SourceId,
    apply_state_to_layer, error::CoreError,
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

        let existing = next_font
            .glyph(from_name)
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

        if from_name != name && next_font.glyph(name).is_some() {
            return Err(WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: format!("{name} already exists"),
            });
        }

        let Some(mut glyph) = next_font.take_glyph(from_name) else {
            return Err(WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: from_name.to_string(),
            });
        };

        let glyph_id = glyph.id();
        let from_name = glyph.glyph_name().clone();
        let from_unicodes = glyph.unicodes().to_vec();
        let glyph_name = shift_font::GlyphName::new(name.to_string()).map_err(|_| {
            WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: name.to_string(),
            }
        })?;

        glyph.set_name(glyph_name);
        glyph.set_unicodes(unicodes);
        let to_name = glyph.glyph_name().clone();
        let to_unicodes = glyph.unicodes().to_vec();
        next_font.put_glyph(glyph);

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

    pub fn set_x_advance(
        &mut self,
        target: GlyphLayerTarget,
        width: f64,
    ) -> Result<GlyphValueChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                layer.set_x_advance(width);
                Ok(GlyphValueChange::from_layer(layer, Default::default()))
            },
            |target, layer, _change| {
                FontChangeSet::new(vec![FontChange::LayerMetricsChanged(
                    shift_font::LayerMetricsChanged::from_layer(target.clone(), layer),
                )])
            },
        )
    }

    pub fn translate_layer(
        &mut self,
        target: GlyphLayerTarget,
        dx: f64,
        dy: f64,
    ) -> Result<GlyphValueChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                layer.translate_layer(dx, dy);
                Ok(GlyphValueChange::from_layer(layer, Default::default()))
            },
            layer_replaced_change,
        )
    }

    pub fn add_point(
        &mut self,
        target: GlyphLayerTarget,
        contour_id: ContourId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                let point_id = layer.add_point_to_contour(contour_id, x, y, point_type, smooth)?;
                let changed = GlyphChangedEntities {
                    point_ids: vec![point_id],
                    ..Default::default()
                };
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            move |target, layer, change| {
                let contour = layer
                    .contour(contour_id)
                    .map(shift_font::ContourValue::from);
                contour
                    .map(|contour| {
                        one_change(FontChange::PointsAdded(shift_font::PointsAdded {
                            target: target.clone(),
                            contour,
                            point_ids: change.changed.point_ids.clone(),
                        }))
                    })
                    .unwrap_or_default()
            },
        )
    }

    pub fn insert_point_before(
        &mut self,
        target: GlyphLayerTarget,
        before_point_id: PointId,
        x: f64,
        y: f64,
        point_type: PointType,
        smooth: bool,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                let point_id =
                    layer.insert_point_before(before_point_id, x, y, point_type, smooth)?;
                let changed = GlyphChangedEntities {
                    point_ids: vec![point_id],
                    ..Default::default()
                };
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            move |target, layer, change| {
                let Some(contour_id) = layer.find_point_contour(before_point_id) else {
                    return layer_replaced_change(target, layer, change);
                };
                let Some(contour) = layer
                    .contour(contour_id)
                    .map(shift_font::ContourValue::from)
                else {
                    return layer_replaced_change(target, layer, change);
                };
                one_change(FontChange::PointsAdded(shift_font::PointsAdded {
                    target: target.clone(),
                    contour,
                    point_ids: change.changed.point_ids.clone(),
                }))
            },
        )
    }

    pub fn add_contour(
        &mut self,
        target: GlyphLayerTarget,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                let contour_id = layer.add_empty_contour();
                let changed = GlyphChangedEntities {
                    contour_ids: vec![contour_id],
                    ..Default::default()
                };
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            |target, layer, change| {
                let Some(contour) = layer
                    .contours_iter()
                    .last()
                    .map(shift_font::ContourValue::from)
                else {
                    return layer_replaced_change(target, layer, change);
                };
                one_change(FontChange::ContourAdded(shift_font::ContourAdded {
                    target: target.clone(),
                    contour,
                }))
            },
        )
    }

    pub fn open_contour(
        &mut self,
        target: GlyphLayerTarget,
        contour_id: ContourId,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.set_contour_closed(target, contour_id, false)
    }

    pub fn close_contour(
        &mut self,
        target: GlyphLayerTarget,
        contour_id: ContourId,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.set_contour_closed(target, contour_id, true)
    }

    pub fn reverse_contour(
        &mut self,
        target: GlyphLayerTarget,
        contour_id: ContourId,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                layer.reverse_contour(contour_id)?;
                let changed = GlyphChangedEntities {
                    contour_ids: vec![contour_id],
                    ..Default::default()
                };
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            layer_replaced_change,
        )
    }

    pub fn apply_boolean_op(
        &mut self,
        target: GlyphLayerTarget,
        contour_id_a: ContourId,
        contour_id_b: ContourId,
        operation: BooleanOp,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                let created_ids = layer.apply_boolean_op(contour_id_a, contour_id_b, operation)?;
                let changed = GlyphChangedEntities {
                    contour_ids: created_ids,
                    ..Default::default()
                };
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            layer_replaced_change,
        )
    }

    pub fn remove_points(
        &mut self,
        target: GlyphLayerTarget,
        point_ids: Vec<PointId>,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                layer.remove_points(&point_ids)?;
                let changed = GlyphChangedEntities::points(point_ids);
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            layer_replaced_change,
        )
    }

    pub fn toggle_smooth(
        &mut self,
        target: GlyphLayerTarget,
        point_id: PointId,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                layer.toggle_smooth(point_id)?;
                let changed = GlyphChangedEntities {
                    point_ids: vec![point_id],
                    ..Default::default()
                };
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            move |target, layer, change| {
                let smooth = layer
                    .contours_iter()
                    .find_map(|contour| contour.get_point(point_id))
                    .map(|point| point.is_smooth());
                smooth
                    .map(|smooth| {
                        one_change(FontChange::PointSmoothChanged(
                            shift_font::PointSmoothChanged {
                                target: target.clone(),
                                point_id,
                                smooth,
                            },
                        ))
                    })
                    .unwrap_or_else(|| layer_replaced_change(target, layer, change))
            },
        )
    }

    pub fn apply_position_patch(
        &mut self,
        target: GlyphLayerTarget,
        updates: BulkNodePositionUpdates<'_>,
        point_position_changes: Vec<PointPosition>,
        has_anchor_updates: bool,
    ) -> Result<(), WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                layer.apply_bulk_node_positions(updates)?;
                Ok(())
            },
            move |target, layer, result| {
                if has_anchor_updates {
                    return layer_replaced_change(target, layer, result);
                }

                one_change(FontChange::PointPositionsChanged(
                    shift_font::PointPositionsChanged {
                        target: target.clone(),
                        points: point_position_changes,
                    },
                ))
            },
        )
    }

    pub fn restore_state(
        &mut self,
        target: GlyphLayerTarget,
        structure: &GlyphStructure,
        values: &[f64],
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                apply_state_to_layer(layer, structure, values)?;
                Ok(GlyphStructureChange::from_layer(layer, Default::default()))
            },
            layer_replaced_change,
        )
    }

    pub fn edit_glyph_layer<R>(
        &mut self,
        target: GlyphLayerTarget,
        edit: impl FnOnce(&mut GlyphLayer) -> Result<R, CoreError>,
        changes: impl FnOnce(&GlyphLayerChangeTarget, &GlyphLayer, &R) -> FontChangeSet,
    ) -> Result<R, WorkspaceError> {
        let mut next_font = self.font.clone();
        let mut change_set = FontChangeSet::default();

        if next_font.glyph(&target.glyph_name).is_none() {
            let mut glyph = Glyph::new(target.glyph_name.clone());
            if let Some(unicode) = target.unicode {
                glyph.add_unicode(unicode);
            }
            glyph.set_layer(target.layer_id, GlyphLayer::with_width(500.0));
            change_set.push(FontChange::GlyphCreated(GlyphCreated::from(&glyph)));
            next_font.insert_glyph(glyph);
        }

        let source_id = source_id_for_layer(&next_font, target.layer_id).ok_or_else(|| {
            WorkspaceError::InvalidInput {
                kind: "layer ID",
                value: target.layer_id.to_string(),
            }
        })?;
        let glyph =
            next_font
                .glyph(&target.glyph_name)
                .ok_or_else(|| WorkspaceError::InvalidInput {
                    kind: "glyph name",
                    value: target.glyph_name.clone(),
                })?;
        let change_target = GlyphLayerChangeTarget {
            glyph_id: glyph.id(),
            glyph_name: glyph.glyph_name().clone(),
            source_id,
            layer_id: target.layer_id,
        };
        let glyph = next_font.glyph_mut(&target.glyph_name).ok_or_else(|| {
            WorkspaceError::InvalidInput {
                kind: "glyph name",
                value: target.glyph_name.clone(),
            }
        })?;

        if let Some(unicode) = target.unicode {
            glyph.add_unicode(unicode);
        }

        let layer = glyph.get_or_create_layer(target.layer_id);
        let result = edit(layer)?;
        let layer_changes = changes(&change_target, layer, &result);
        change_set.changes.extend(layer_changes.changes);

        self.commit_font(next_font, change_set)?;

        Ok(result)
    }

    fn set_contour_closed(
        &mut self,
        target: GlyphLayerTarget,
        contour_id: ContourId,
        closed: bool,
    ) -> Result<GlyphStructureChange, WorkspaceError> {
        self.edit_glyph_layer(
            target,
            |layer| {
                if closed {
                    layer.close_contour(contour_id)?;
                } else {
                    layer.open_contour(contour_id)?;
                }
                let changed = GlyphChangedEntities {
                    contour_ids: vec![contour_id],
                    ..Default::default()
                };
                Ok(GlyphStructureChange::from_layer(layer, changed))
            },
            move |target, _layer, _change| {
                one_change(FontChange::ContourOpenClosedChanged(
                    shift_font::ContourOpenClosedChanged {
                        target: target.clone(),
                        contour_id,
                        closed,
                    },
                ))
            },
        )
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

fn one_change(change: FontChange) -> FontChangeSet {
    FontChangeSet::new(vec![change])
}

fn layer_replaced_change(
    target: &GlyphLayerChangeTarget,
    layer: &GlyphLayer,
    _result: &impl Sized,
) -> FontChangeSet {
    one_change(FontChange::LayerGeometryReplaced(
        shift_font::LayerGeometryReplaced {
            target: target.clone(),
            layer: shift_font::GlyphLayerValue::from(layer),
        },
    ))
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

fn source_id_for_layer(font: &shift_font::Font, layer_id: LayerId) -> Option<SourceId> {
    font.sources()
        .iter()
        .find(|source| source.layer_id() == layer_id)
        .map(shift_font::Source::id)
        .or_else(|| font.default_source().map(shift_font::Source::id))
}
