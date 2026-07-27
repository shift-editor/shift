use rusqlite::OptionalExtension;

use crate::{ComponentId, GlyphId, LayerId, ShiftStore, StoreError};

pub struct NewGlyphComponent {
    pub id: ComponentId,
    pub layer_id: LayerId,
    pub base_glyph_id: GlyphId,
    pub base_glyph_name: String,
    pub transform: shift_font::DecomposedTransform,
    pub order_index: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphComponentRecord {
    pub id: ComponentId,
    pub layer_id: LayerId,
    pub base_glyph_id: GlyphId,
    pub base_glyph_name: String,
    pub transform: shift_font::DecomposedTransform,
    pub order_index: i64,
}

impl ShiftStore {
    pub fn create_glyph_component(
        &mut self,
        component: NewGlyphComponent,
    ) -> Result<(), StoreError> {
        let layer_id = shift_font::LayerId::from_raw(component.layer_id.as_str());
        let mut layer =
            self.load_glyph_layer(&layer_id)?
                .ok_or_else(|| StoreError::MissingEntity {
                    kind: "glyph layer",
                    id: layer_id.to_string(),
                })?;
        if component.order_index != layer.components().len() as i64 {
            return Err(StoreError::InvalidWorkspaceState(format!(
                "component order {} does not append to layer {}",
                component.order_index, layer_id
            )));
        }
        layer.add_component(shift_font::Component::with_id(
            shift_font::ComponentId::from_raw(component.id.as_str()),
            shift_font::GlyphId::from_raw(component.base_glyph_id.as_str()),
            component.base_glyph_name,
            component.transform,
        ));
        self.replace_glyph_layer(&layer)
    }

    pub fn get_glyph_component(
        &self,
        id: &ComponentId,
    ) -> Result<Option<GlyphComponentRecord>, StoreError> {
        let layer_id = self
            .conn
            .query_row(
                "SELECT layer_id FROM glyph_components WHERE id = ?1",
                [id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(layer_id) = layer_id else {
            return Ok(None);
        };
        let layer_id = shift_font::LayerId::from_raw(layer_id);
        let Some(layer) = self.load_glyph_layer(&layer_id)? else {
            return Ok(None);
        };
        Ok(layer
            .components_iter()
            .enumerate()
            .find(|(_, component)| component.id().as_str() == id.as_str())
            .map(|(order_index, component)| component_record(&layer, component, order_index)))
    }

    pub fn list_glyph_components_for_layer(
        &self,
        layer_id: &LayerId,
    ) -> Result<Vec<GlyphComponentRecord>, StoreError> {
        let layer_id = shift_font::LayerId::from_raw(layer_id.as_str());
        let Some(layer) = self.load_glyph_layer(&layer_id)? else {
            return Ok(Vec::new());
        };
        Ok(layer
            .components_iter()
            .enumerate()
            .map(|(order_index, component)| component_record(&layer, component, order_index))
            .collect())
    }
}

fn component_record(
    layer: &shift_font::GlyphLayer,
    component: &shift_font::Component,
    order_index: usize,
) -> GlyphComponentRecord {
    GlyphComponentRecord {
        id: ComponentId::new(component.id().to_string()),
        layer_id: LayerId::new(layer.id().to_string()),
        base_glyph_id: GlyphId::new(component.base_glyph_id().to_string()),
        base_glyph_name: component.base_glyph_name().to_string(),
        transform: *component.transform(),
        order_index: order_index as i64,
    }
}
