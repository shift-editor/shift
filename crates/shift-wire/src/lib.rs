//! document state types shared by edit logic and bridge bindings.
//!
//! These types split stable glyph structure from mutable numeric values. The
//! values layout is canonical and must stay in lockstep with every consumer.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use shift_font::{
    Axis as IrAxis, FontMetadata as IrFontMetadata, FontMetrics as IrFontMetrics, Glyph as IrGlyph,
    GlyphName, LayerId, Location as IrLocation, Source as IrSource, SourceId,
};

pub use shift_font::{
    apply_state_to_layer, layer_from_state, values_from_layer, AnchorData, AxisTent, ComponentData,
    ContourData, GlyphChangedEntities, GlyphMaster, GlyphState, GlyphStructure,
    GlyphStructureChange, GlyphValue, GlyphValueChange, GlyphValues, GlyphVariationData, PointData,
    PointType,
};

pub mod bridges;
pub mod interpolation;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetadata {
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub version_major: Option<i32>,
    pub version_minor: Option<i32>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub designer: Option<String>,
    pub designer_url: Option<String>,
    pub manufacturer: Option<String>,
    pub manufacturer_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
}

impl From<&IrFontMetadata> for FontMetadata {
    fn from(metadata: &IrFontMetadata) -> Self {
        Self {
            family_name: metadata.family_name.clone(),
            style_name: metadata.style_name.clone(),
            version_major: metadata.version_major,
            version_minor: metadata.version_minor,
            copyright: metadata.copyright.clone(),
            trademark: metadata.trademark.clone(),
            designer: metadata.designer.clone(),
            designer_url: metadata.designer_url.clone(),
            manufacturer: metadata.manufacturer.clone(),
            manufacturer_url: metadata.manufacturer_url.clone(),
            license: metadata.license.clone(),
            license_url: metadata.license_url.clone(),
            description: metadata.description.clone(),
            note: metadata.note.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetrics {
    pub units_per_em: f64,
    pub ascender: f64,
    pub descender: f64,
    pub cap_height: Option<f64>,
    pub x_height: Option<f64>,
    pub line_gap: Option<f64>,
    pub italic_angle: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

impl From<&IrFontMetrics> for FontMetrics {
    fn from(metrics: &IrFontMetrics) -> Self {
        Self {
            units_per_em: metrics.units_per_em,
            ascender: metrics.ascender,
            descender: metrics.descender,
            cap_height: metrics.cap_height,
            x_height: metrics.x_height,
            line_gap: metrics.line_gap,
            italic_angle: metrics.italic_angle,
            underline_position: metrics.underline_position,
            underline_thickness: metrics.underline_thickness,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    pub tag: String,
    pub name: String,
    pub minimum: f64,
    pub default: f64,
    pub maximum: f64,
    pub hidden: bool,
}

impl From<&IrAxis> for Axis {
    fn from(axis: &IrAxis) -> Self {
        Self {
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            minimum: axis.minimum(),
            default: axis.default(),
            maximum: axis.maximum(),
            hidden: axis.is_hidden(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: SourceId,
    pub name: String,
    pub location: Location,
    pub layer_id: LayerId,
    pub filename: Option<String>,
}

impl From<&IrSource> for Source {
    fn from(source: &IrSource) -> Self {
        Self {
            id: source.id(),
            name: source.name().to_string(),
            location: source.location().into(),
            layer_id: source.layer_id(),
            filename: source.filename().map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphRecord {
    pub name: GlyphName,
    pub unicodes: Vec<u32>,
    pub component_base_glyph_names: Vec<GlyphName>,
}

impl From<&IrGlyph> for GlyphRecord {
    fn from(glyph: &IrGlyph) -> Self {
        let mut component_base_glyph_names: Vec<_> = glyph
            .layers()
            .values()
            .flat_map(|layer| layer.components_iter())
            .map(|component| component.base_glyph().clone())
            .collect();
        component_base_glyph_names.sort();
        component_base_glyph_names.dedup();

        Self {
            name: glyph.glyph_name().clone(),
            unicodes: glyph.unicodes().to_vec(),
            component_base_glyph_names,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub values: HashMap<String, f64>,
}

impl From<&IrLocation> for Location {
    fn from(location: &IrLocation) -> Self {
        Self {
            values: location
                .iter()
                .map(|(tag, value)| (tag.clone(), *value))
                .collect(),
        }
    }
}
