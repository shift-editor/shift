use glyphs_reader::{FeatureSnippet, Font as GlyphsFont, NodeType, Shape};
use shift_ir::{
    Anchor, Axis, Component, Contour, FeatureData, Font, Glyph, GlyphLayer, KerningData,
    KerningPair, KerningSide, Layer, Location, Source, Transform,
};
use std::collections::HashMap;
use std::path::Path;

use crate::traits::FontReader;

const GLYPHS_SIDE1_PREFIX: &str = "@MMK_L_";
const GLYPHS_SIDE2_PREFIX: &str = "@MMK_R_";
const UFO_SIDE1_PREFIX: &str = "public.kern1.";
const UFO_SIDE2_PREFIX: &str = "public.kern2.";

pub struct GlyphsReader;

impl GlyphsReader {
    pub fn new() -> Self {
        Self
    }

    fn convert_node_type(node_type: NodeType) -> (shift_ir::PointType, bool) {
        match node_type {
            NodeType::Line => (shift_ir::PointType::OnCurve, false),
            NodeType::LineSmooth => (shift_ir::PointType::OnCurve, true),
            NodeType::OffCurve => (shift_ir::PointType::OffCurve, false),
            NodeType::Curve => (shift_ir::PointType::OnCurve, false),
            NodeType::CurveSmooth => (shift_ir::PointType::OnCurve, true),
            NodeType::QCurve => (shift_ir::PointType::QCurve, false),
            NodeType::QCurveSmooth => (shift_ir::PointType::QCurve, true),
        }
    }

    fn convert_features(font: &GlyphsFont) -> FeatureData {
        let source = font
            .features
            .iter()
            .filter_map(FeatureSnippet::str_if_enabled)
            .collect::<Vec<_>>()
            .join("\n\n");
        if source.trim().is_empty() {
            FeatureData::new()
        } else {
            FeatureData::from_fea(source)
        }
    }

    fn convert_kerning(font: &GlyphsFont) -> KerningData {
        let mut kerning = KerningData::new();

        // Build group membership from glyph-level kerning groups.
        for glyph in font.glyphs.values() {
            if let Some(group) = glyph.right_kern.as_deref() {
                let group_name = format!("{UFO_SIDE1_PREFIX}{group}");
                let mut members = kerning
                    .groups1()
                    .get(&group_name)
                    .cloned()
                    .unwrap_or_default();
                members.push(glyph.name.to_string());
                members.sort();
                members.dedup();
                kerning.set_group1(group_name, members);
            }

            if let Some(group) = glyph.left_kern.as_deref() {
                let group_name = format!("{UFO_SIDE2_PREFIX}{group}");
                let mut members = kerning
                    .groups2()
                    .get(&group_name)
                    .cloned()
                    .unwrap_or_default();
                members.push(glyph.name.to_string());
                members.sort();
                members.dedup();
                kerning.set_group2(group_name, members);
            }
        }

        // shift-ir currently stores static kerning, so we load kerning for default master.
        let Some(default_master) = font.masters.get(font.default_master_idx) else {
            return kerning;
        };

        let Some(pairs) = font.kerning_ltr.get(&default_master.id) else {
            return kerning;
        };

        for ((first, second), value) in pairs {
            let first_side = if let Some(group) = first
                .strip_prefix(GLYPHS_SIDE1_PREFIX)
                .or_else(|| first.strip_prefix(GLYPHS_SIDE2_PREFIX))
            {
                KerningSide::Group(format!("{UFO_SIDE1_PREFIX}{group}"))
            } else {
                KerningSide::Glyph(first.clone())
            };

            let second_side = if let Some(group) = second
                .strip_prefix(GLYPHS_SIDE2_PREFIX)
                .or_else(|| second.strip_prefix(GLYPHS_SIDE1_PREFIX))
            {
                KerningSide::Group(format!("{UFO_SIDE2_PREFIX}{group}"))
            } else {
                KerningSide::Glyph(second.clone())
            };

            kerning.add_pair(KerningPair::new(
                first_side,
                second_side,
                value.into_inner(),
            ));
        }

        kerning
    }
}

impl Default for GlyphsReader {
    fn default() -> Self {
        Self::new()
    }
}

impl FontReader for GlyphsReader {
    fn load(&self, path: &str) -> Result<Font, String> {
        let glyphs_font =
            GlyphsFont::load(Path::new(path)).map_err(|e| format!("Failed to load glyphs: {e}"))?;

        let mut font = Font::new();
        let default_layer_id = font.default_layer_id();

        // Metadata and metrics from default master.
        if let Some(family_name) = glyphs_font.names.get("familyNames") {
            font.metadata_mut().family_name = Some(family_name.clone());
        }
        if let Some(default_master) = glyphs_font.masters.get(glyphs_font.default_master_idx) {
            font.metadata_mut().style_name = Some(default_master.name.clone());
            font.metrics_mut().ascender = default_master.ascender().unwrap_or(800.0);
            font.metrics_mut().descender = default_master.descender().unwrap_or(-200.0);
            font.metrics_mut().cap_height = default_master.cap_height();
            font.metrics_mut().x_height = default_master.x_height();
            font.metrics_mut().italic_angle = default_master.italic_angle();
        }
        font.metadata_mut().version_major = Some(glyphs_font.version_major);
        font.metadata_mut().version_minor = Some(glyphs_font.version_minor as i32);
        font.metrics_mut().units_per_em = glyphs_font.units_per_em as f64;

        // Axes and source locations derived from masters.
        for (idx, glyphs_axis) in glyphs_font.axes.iter().enumerate() {
            let axis_values: Vec<f64> = glyphs_font
                .masters
                .iter()
                .filter_map(|m| m.axes_values.get(idx).map(|v| v.into_inner()))
                .collect();
            if axis_values.is_empty() {
                continue;
            }

            let default = glyphs_font
                .masters
                .get(glyphs_font.default_master_idx)
                .and_then(|m| m.axes_values.get(idx))
                .map(|v| v.into_inner())
                .unwrap_or(axis_values[0]);
            let minimum = axis_values.iter().copied().fold(f64::INFINITY, f64::min);
            let maximum = axis_values
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max);

            let mut axis = Axis::new(
                glyphs_axis.tag.clone(),
                glyphs_axis.name.clone(),
                minimum,
                default,
                maximum,
            );
            axis.set_hidden(glyphs_axis.hidden.unwrap_or(false));
            font.add_axis(axis);
        }

        let mut layer_by_master_id = HashMap::new();
        for (master_idx, master) in glyphs_font.masters.iter().enumerate() {
            let layer_id = if master_idx == glyphs_font.default_master_idx {
                default_layer_id
            } else {
                font.add_layer(Layer::new(master.name.clone()))
            };
            layer_by_master_id.insert(master.id.clone(), layer_id);

            let mut location = Location::new();
            for (axis_idx, axis) in glyphs_font.axes.iter().enumerate() {
                if let Some(value) = master.axes_values.get(axis_idx) {
                    location.set(axis.tag.clone(), value.into_inner());
                }
            }
            font.add_source(Source::new(master.name.clone(), location, layer_id));
        }

        for glyph in glyphs_font.glyphs.values() {
            let mut ir_glyph = Glyph::new(glyph.name.to_string());
            for unicode in glyph.unicode.iter() {
                ir_glyph.add_unicode(*unicode);
            }

            for layer in &glyph.layers {
                let Some(layer_id) = layer_by_master_id.get(layer.master_id()).copied() else {
                    continue;
                };

                let mut ir_layer = GlyphLayer::with_width(layer.width.into_inner());

                for shape in &layer.shapes {
                    match shape {
                        Shape::Path(path) => {
                            let mut contour = Contour::new();
                            for node in &path.nodes {
                                let (point_type, smooth) = Self::convert_node_type(node.node_type);
                                contour.add_point(node.pt.x, node.pt.y, point_type, smooth);
                            }
                            if path.closed {
                                contour.close();
                            }
                            ir_layer.add_contour(contour);
                        }
                        Shape::Component(component) => {
                            let coeffs = component.transform.as_coeffs();
                            let matrix = Transform {
                                xx: coeffs[0],
                                xy: coeffs[1],
                                yx: coeffs[2],
                                yy: coeffs[3],
                                dx: coeffs[4],
                                dy: coeffs[5],
                            };
                            ir_layer.add_component(Component::with_matrix(
                                component.name.to_string(),
                                &matrix,
                            ));
                        }
                    }
                }

                for anchor in &layer.anchors {
                    let name = if anchor.name.is_empty() {
                        None
                    } else {
                        Some(anchor.name.to_string())
                    };
                    ir_layer.add_anchor(Anchor::new(name, anchor.pos.x, anchor.pos.y));
                }

                ir_glyph.set_layer(layer_id, ir_layer);
            }

            font.insert_glyph(ir_glyph);
        }

        *font.features_mut() = Self::convert_features(&glyphs_font);
        *font.kerning_mut() = Self::convert_kerning(&glyphs_font);

        Ok(font)
    }
}
