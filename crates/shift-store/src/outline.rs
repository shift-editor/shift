use crate::{LayerId, ShiftStore, StoreError};

#[derive(Clone, Debug, PartialEq)]
pub struct ContourRecord {
    pub id: String,
    pub layer_id: LayerId,
    pub closed: bool,
    pub order_index: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PointRecord {
    pub id: String,
    pub contour_id: String,
    pub order_index: i64,
    pub x: f64,
    pub y: f64,
    pub point_type: String,
    pub smooth: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AnchorRecord {
    pub id: String,
    pub layer_id: LayerId,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
    pub order_index: i64,
}

impl ShiftStore {
    pub fn list_contours_for_layer(
        &self,
        layer_id: &LayerId,
    ) -> Result<Vec<ContourRecord>, StoreError> {
        let layer_id = shift_font::LayerId::from_raw(layer_id.as_str());
        let Some(layer) = self.load_glyph_layer(&layer_id)? else {
            return Ok(Vec::new());
        };
        Ok(layer
            .contours_iter()
            .enumerate()
            .map(|(order_index, contour)| ContourRecord {
                id: contour.id().to_string(),
                layer_id: LayerId::new(layer.id().to_string()),
                closed: contour.is_closed(),
                order_index: order_index as i64,
            })
            .collect())
    }

    /// Compatibility lookup for callers that only retain a contour id.
    /// Interactive acquisition should address a layer directly.
    pub fn list_points_for_contour(
        &self,
        contour_id: &str,
    ) -> Result<Vec<PointRecord>, StoreError> {
        for entry in self.list_glyph_layer_directory()? {
            let Some(layer) = self.load_glyph_layer(&entry.layer_id)? else {
                continue;
            };
            let Some(contour) = layer
                .contours_iter()
                .find(|contour| contour.id().as_str() == contour_id)
            else {
                continue;
            };
            return Ok(contour
                .points()
                .iter()
                .enumerate()
                .map(|(order_index, point)| PointRecord {
                    id: point.id().to_string(),
                    contour_id: contour_id.to_owned(),
                    order_index: order_index as i64,
                    x: point.x(),
                    y: point.y(),
                    point_type: point_type_name(point.point_type()).to_owned(),
                    smooth: point.is_smooth(),
                })
                .collect());
        }
        Ok(Vec::new())
    }

    pub fn list_anchors_for_layer(
        &self,
        layer_id: &LayerId,
    ) -> Result<Vec<AnchorRecord>, StoreError> {
        let layer_id = shift_font::LayerId::from_raw(layer_id.as_str());
        let Some(layer) = self.load_glyph_layer(&layer_id)? else {
            return Ok(Vec::new());
        };
        Ok(layer
            .anchors_iter()
            .enumerate()
            .map(|(order_index, anchor)| AnchorRecord {
                id: anchor.id().to_string(),
                layer_id: LayerId::new(layer.id().to_string()),
                name: anchor.name().map(str::to_owned),
                x: anchor.x(),
                y: anchor.y(),
                order_index: order_index as i64,
            })
            .collect())
    }
}

fn point_type_name(point_type: shift_font::PointType) -> &'static str {
    match point_type {
        shift_font::PointType::OnCurve => "onCurve",
        shift_font::PointType::OffCurve => "offCurve",
        shift_font::PointType::QCurve => "qCurve",
    }
}
