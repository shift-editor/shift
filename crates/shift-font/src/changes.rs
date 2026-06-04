use crate::{
    Contour, ContourId, Glyph, GlyphId, GlyphLayer, GlyphName, LayerId, Point, PointId, PointType,
    SourceId,
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

#[derive(Clone, Debug)]
pub enum FontChange {
    GlyphCreated(GlyphCreated),
    GlyphIdentityChanged(GlyphIdentityChanged),
    LayerMetricsChanged(LayerMetricsChanged),
    ContourAdded(ContourAdded),
    ContourOpenClosedChanged(ContourOpenClosedChanged),
    PointsAdded(PointsAdded),
    PointsDeleted(PointsDeleted),
    PointSmoothChanged(PointSmoothChanged),
    PointPositionsChanged(PointPositionsChanged),
    LayerGeometryReplaced(LayerGeometryReplaced),
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
pub struct GlyphIdentityChanged {
    pub glyph_id: GlyphId,
    pub from_name: GlyphName,
    pub to_name: GlyphName,
    pub from_unicodes: Vec<u32>,
    pub to_unicodes: Vec<u32>,
}

#[derive(Clone, Debug)]
pub struct GlyphLayerChangeTarget {
    pub glyph_id: GlyphId,
    pub glyph_name: GlyphName,
    pub source_id: SourceId,
    pub layer_id: LayerId,
}

#[derive(Clone, Debug)]
pub struct LayerMetricsChanged {
    pub target: GlyphLayerChangeTarget,
    pub width: f64,
    pub height: Option<f64>,
}

impl LayerMetricsChanged {
    pub fn from_layer(target: GlyphLayerChangeTarget, layer: &GlyphLayer) -> Self {
        Self {
            target,
            width: layer.width(),
            height: layer.height(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct ContourAdded {
    pub target: GlyphLayerChangeTarget,
    pub contour: ContourValue,
}

#[derive(Clone, Debug)]
pub struct ContourOpenClosedChanged {
    pub target: GlyphLayerChangeTarget,
    pub contour_id: ContourId,
    pub closed: bool,
}

#[derive(Clone, Debug)]
pub struct PointsAdded {
    pub target: GlyphLayerChangeTarget,
    pub contour: ContourValue,
    pub point_ids: Vec<PointId>,
}

#[derive(Clone, Debug)]
pub struct PointsDeleted {
    pub target: GlyphLayerChangeTarget,
    pub contour: ContourValue,
    pub point_ids: Vec<PointId>,
}

#[derive(Clone, Debug)]
pub struct PointSmoothChanged {
    pub target: GlyphLayerChangeTarget,
    pub point_id: PointId,
    pub smooth: bool,
}

#[derive(Clone, Debug)]
pub struct PointPositionsChanged {
    pub target: GlyphLayerChangeTarget,
    pub points: Vec<PointPosition>,
}

#[derive(Clone, Debug)]
pub struct PointPosition {
    pub point_id: PointId,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct LayerGeometryReplaced {
    pub target: GlyphLayerChangeTarget,
    pub layer: GlyphLayerValue,
}

#[derive(Clone, Debug)]
pub struct GlyphLayerValue {
    pub width: f64,
    pub height: Option<f64>,
    pub contours: Vec<ContourValue>,
}

impl From<&GlyphLayer> for GlyphLayerValue {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            width: layer.width(),
            height: layer.height(),
            contours: layer.contours_iter().map(ContourValue::from).collect(),
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
