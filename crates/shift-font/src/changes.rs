use crate::{
    Anchor, AnchorId, Axis, AxisId, Contour, ContourId, Glyph, GlyphId, GlyphLayer, GlyphName,
    LayerId, Point, PointId, PointType, Source, SourceId,
};

#[derive(Clone, Debug, Default)]
pub struct FontChangeSet {
    pub changes: Vec<FontChange>,
}

impl FontChangeSet {
    pub fn new(changes: Vec<FontChange>) -> Self {
        Self { changes }
    }

    pub fn push(&mut self, change: FontChange) {
        self.changes.push(change);
    }

    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }
}

impl From<FontChange> for FontChangeSet {
    fn from(change: FontChange) -> Self {
        Self::new(vec![change])
    }
}

#[derive(Clone, Debug)]
pub enum FontChange {
    AxisCreated(AxisCreated),
    AxisDeleted(AxisDeleted),
    SourceCreated(SourceCreated),
    SourceDeleted(SourceDeleted),
    GlyphCreated(GlyphCreated),
    GlyphDeleted(GlyphDeleted),
    GlyphIdentityChanged(GlyphIdentityChanged),
    GlyphLayerCreated(GlyphLayerCreated),
    LayerMetricsChanged(LayerMetricsChanged),
    ContourAdded(ContourAdded),
    ContourOpenClosedChanged(ContourOpenClosedChanged),
    PointsAdded(PointsAdded),
    PointsDeleted(PointsDeleted),
    PointSmoothChanged(PointSmoothChanged),
    PointPositionsChanged(PointPositionsChanged),
    AnchorPositionsChanged(AnchorPositionsChanged),
    LayerGeometryReplaced(LayerGeometryReplaced),
}

impl FontChange {
    pub fn axis_created(axis: &Axis) -> Self {
        Self::AxisCreated(AxisCreated::from(axis))
    }

    pub fn axis_deleted(axis_id: AxisId) -> Self {
        Self::AxisDeleted(AxisDeleted { axis_id })
    }

    pub fn source_created(source: &Source) -> Self {
        Self::SourceCreated(SourceCreated::from(source))
    }

    pub fn source_deleted(source_id: SourceId) -> Self {
        Self::SourceDeleted(SourceDeleted { source_id })
    }

    pub fn glyph_created(glyph: &Glyph) -> Self {
        Self::GlyphCreated(GlyphCreated::from(glyph))
    }

    pub fn glyph_deleted(glyph_id: GlyphId) -> Self {
        Self::GlyphDeleted(GlyphDeleted { glyph_id })
    }

    pub fn glyph_identity_changed(
        glyph_id: GlyphId,
        from_name: GlyphName,
        to_name: GlyphName,
        from_unicodes: Vec<u32>,
        to_unicodes: Vec<u32>,
    ) -> Self {
        Self::GlyphIdentityChanged(GlyphIdentityChanged {
            glyph_id,
            from_name,
            to_name,
            from_unicodes,
            to_unicodes,
        })
    }

    pub fn glyph_layer_created(
        glyph_id: GlyphId,
        name: Option<GlyphName>,
        layer: &GlyphLayer,
    ) -> Self {
        Self::GlyphLayerCreated(GlyphLayerCreated::from_layer(glyph_id, name, layer))
    }

    pub fn layer_metrics_changed(layer: &GlyphLayer) -> Self {
        Self::LayerMetricsChanged(LayerMetricsChanged::from_layer(layer))
    }

    pub fn contour_added(layer_id: LayerId, contour: &Contour) -> Self {
        Self::ContourAdded(ContourAdded {
            layer_id,
            contour: ContourValue::from(contour),
        })
    }

    pub fn contour_open_closed_changed(
        layer_id: LayerId,
        contour_id: ContourId,
        closed: bool,
    ) -> Self {
        Self::ContourOpenClosedChanged(ContourOpenClosedChanged {
            layer_id,
            contour_id,
            closed,
        })
    }

    pub fn points_added(layer_id: LayerId, contour: &Contour, point_ids: Vec<PointId>) -> Self {
        Self::PointsAdded(PointsAdded {
            layer_id,
            contour: ContourValue::from(contour),
            point_ids,
        })
    }

    pub fn point_smooth_changed(layer_id: LayerId, point_id: PointId, smooth: bool) -> Self {
        Self::PointSmoothChanged(PointSmoothChanged {
            layer_id,
            point_id,
            smooth,
        })
    }

    pub fn point_positions_changed(layer_id: LayerId, points: Vec<PointPosition>) -> Self {
        Self::PointPositionsChanged(PointPositionsChanged { layer_id, points })
    }

    pub fn anchor_positions_changed(layer_id: LayerId, anchors: Vec<AnchorPosition>) -> Self {
        Self::AnchorPositionsChanged(AnchorPositionsChanged { layer_id, anchors })
    }

    pub fn layer_geometry_replaced(layer: &GlyphLayer) -> Self {
        Self::LayerGeometryReplaced(LayerGeometryReplaced {
            layer_id: layer.id(),
            layer: GlyphLayerValue::from(layer),
        })
    }
}

#[derive(Clone, Debug)]
pub struct AxisCreated {
    pub axis_id: AxisId,
    pub tag: String,
    pub name: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub hidden: bool,
}

impl From<&Axis> for AxisCreated {
    fn from(axis: &Axis) -> Self {
        Self {
            axis_id: axis.id(),
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            minimum: axis.minimum(),
            default: axis.default(),
            maximum: axis.maximum(),
            hidden: axis.is_hidden(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SourceCreated {
    pub source_id: SourceId,
    pub name: String,
    pub location: Vec<SourceAxisValue>,
}

impl From<&Source> for SourceCreated {
    fn from(source: &Source) -> Self {
        Self {
            source_id: source.id(),
            name: source.name().to_string(),
            location: source
                .location()
                .iter()
                .map(|(axis_id, value)| SourceAxisValue {
                    axis_id: axis_id.clone(),
                    value: *value,
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct AxisDeleted {
    pub axis_id: AxisId,
}

#[derive(Clone, Debug)]
pub struct SourceDeleted {
    pub source_id: SourceId,
}

#[derive(Clone, Debug)]
pub struct SourceAxisValue {
    pub axis_id: AxisId,
    pub value: f64,
}

#[derive(Clone, Debug)]
pub struct GlyphCreated {
    pub glyph_id: GlyphId,
    pub name: GlyphName,
    pub unicodes: Vec<u32>,
}

impl From<&Glyph> for GlyphCreated {
    fn from(glyph: &Glyph) -> Self {
        Self {
            glyph_id: glyph.id(),
            name: glyph.glyph_name().clone(),
            unicodes: glyph.unicodes().to_vec(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct GlyphDeleted {
    pub glyph_id: GlyphId,
}

#[derive(Clone, Debug)]
pub struct GlyphIdentityChanged {
    pub glyph_id: GlyphId,
    pub from_name: GlyphName,
    pub to_name: GlyphName,
    pub from_unicodes: Vec<u32>,
    pub to_unicodes: Vec<u32>,
}

#[derive(Clone, Debug)]
pub struct GlyphLayerCreated {
    pub glyph_id: GlyphId,
    pub source_id: SourceId,
    pub layer_id: LayerId,
    pub name: Option<GlyphName>,
    pub width: f64,
    pub height: Option<f64>,
}

impl GlyphLayerCreated {
    pub fn from_layer(glyph_id: GlyphId, name: Option<GlyphName>, layer: &GlyphLayer) -> Self {
        Self {
            glyph_id,
            source_id: layer.source_id(),
            layer_id: layer.id(),
            name,
            width: layer.width(),
            height: layer.height(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct LayerMetricsChanged {
    pub layer_id: LayerId,
    pub width: f64,
    pub height: Option<f64>,
}

impl LayerMetricsChanged {
    pub fn from_layer(layer: &GlyphLayer) -> Self {
        Self {
            layer_id: layer.id(),
            width: layer.width(),
            height: layer.height(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ContourAdded {
    pub layer_id: LayerId,
    pub contour: ContourValue,
}

#[derive(Clone, Debug)]
pub struct ContourOpenClosedChanged {
    pub layer_id: LayerId,
    pub contour_id: ContourId,
    pub closed: bool,
}

#[derive(Clone, Debug)]
pub struct PointsAdded {
    pub layer_id: LayerId,
    pub contour: ContourValue,
    pub point_ids: Vec<PointId>,
}

#[derive(Clone, Debug)]
pub struct PointsDeleted {
    pub layer_id: LayerId,
    pub contour: ContourValue,
    pub point_ids: Vec<PointId>,
}

#[derive(Clone, Debug)]
pub struct PointSmoothChanged {
    pub layer_id: LayerId,
    pub point_id: PointId,
    pub smooth: bool,
}

#[derive(Clone, Debug)]
pub struct PointPositionsChanged {
    pub layer_id: LayerId,
    pub points: Vec<PointPosition>,
}

#[derive(Clone, Debug)]
pub struct PointPosition {
    pub point_id: PointId,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct AnchorPositionsChanged {
    pub layer_id: LayerId,
    pub anchors: Vec<AnchorPosition>,
}

#[derive(Clone, Debug)]
pub struct AnchorPosition {
    pub anchor_id: AnchorId,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct LayerGeometryReplaced {
    pub layer_id: LayerId,
    pub layer: GlyphLayerValue,
}

#[derive(Clone, Debug)]
pub struct GlyphLayerValue {
    pub width: f64,
    pub height: Option<f64>,
    pub contours: Vec<ContourValue>,
    pub anchors: Vec<AnchorValue>,
}

impl From<&GlyphLayer> for GlyphLayerValue {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            width: layer.width(),
            height: layer.height(),
            contours: layer.contours_iter().map(ContourValue::from).collect(),
            anchors: layer
                .anchors_iter()
                .enumerate()
                .map(|(order_index, anchor)| AnchorValue::from_anchor(order_index, anchor))
                .collect(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ContourValue {
    pub id: ContourId,
    pub closed: bool,
    pub points: Vec<PointValue>,
}

impl From<&Contour> for ContourValue {
    fn from(contour: &Contour) -> Self {
        Self {
            id: contour.id(),
            closed: contour.is_closed(),
            points: contour
                .points()
                .iter()
                .enumerate()
                .map(|(order_index, point)| PointValue::from_point(order_index, point))
                .collect(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct AnchorValue {
    pub id: AnchorId,
    pub order_index: usize,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

impl AnchorValue {
    pub fn from_anchor(order_index: usize, anchor: &Anchor) -> Self {
        Self {
            id: anchor.id(),
            order_index,
            name: anchor.name().map(str::to_owned),
            x: anchor.x(),
            y: anchor.y(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct PointValue {
    pub id: PointId,
    pub order_index: usize,
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

impl PointValue {
    pub fn from_point(order_index: usize, point: &Point) -> Self {
        Self {
            id: point.id(),
            order_index,
            x: point.x(),
            y: point.y(),
            point_type: point.point_type(),
            smooth: point.is_smooth(),
        }
    }
}
