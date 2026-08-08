use std::collections::HashMap;

use glyphs_reader::{
    Anchor as GlyphsAnchor, Component as GlyphsComponent, FeatureSnippet, Font as GlyphsFont,
    FontMaster, Glyph as GlyphsGlyph, NodeType, Shape,
};
use shift_font::{
    Anchor, Axis, AxisMapping, AxisMappingPoint, Component, Contour, DesignLocation,
    ExternalLocation, FeatureData, Font, Glyph, GlyphId, GlyphLayer, KerningData, KerningPair,
    KerningSide, LayerId, Location, MetricKind, NamedInstance, Source, SourceId, Transform,
};

use crate::{
    font_source::piecewise_map, metrics::set_metric_position, FormatBackendError,
    FormatBackendResult,
};

const GLYPHS_SIDE1_PREFIX: &str = "@MMK_L_";
const GLYPHS_SIDE2_PREFIX: &str = "@MMK_R_";
const UFO_SIDE1_PREFIX: &str = "public.kern1.";
const UFO_SIDE2_PREFIX: &str = "public.kern2.";

pub(crate) fn master_design_values(font: &GlyphsFont, axis_index: usize) -> Vec<f64> {
    font.masters
        .iter()
        .filter_map(|master| master.axes_values.get(axis_index))
        .map(|value| value.into_inner())
        .collect()
}

pub(crate) fn default_design_value(font: &GlyphsFont, axis_index: usize, values: &[f64]) -> f64 {
    font.masters
        .get(font.default_master_idx)
        .and_then(|master| master.axes_values.get(axis_index))
        .map(|value| value.into_inner())
        .or_else(|| values.first().copied())
        .unwrap_or(0.0)
}

#[derive(Clone)]
pub(crate) struct GlyphsAxisMapping {
    pub(crate) user_to_design: Box<[(f64, f64)]>,
}

impl GlyphsAxisMapping {
    pub(crate) fn unmap(&self, design: f64) -> f64 {
        let mut design_to_user = self
            .user_to_design
            .iter()
            .map(|(user, design)| (*design, *user))
            .collect::<Vec<_>>();
        design_to_user.sort_by(|left, right| left.0.total_cmp(&right.0));
        design_to_user.dedup_by(|left, right| left.0 == right.0);
        piecewise_map(design, &design_to_user)
    }

    pub(crate) fn user_values(&self) -> impl Iterator<Item = f64> + '_ {
        self.user_to_design.iter().map(|(user, _)| *user)
    }
}

pub(crate) fn glyphs_axis_mapping(
    font: &GlyphsFont,
    axis_index: usize,
    design_values: &[f64],
    design_default: f64,
) -> GlyphsAxisMapping {
    let axis = &font.axes[axis_index];
    let mut mapping = font
        .axis_mappings
        .get(&axis.name)
        .map(|mapping| {
            mapping
                .iter()
                .map(|(user, design)| (user.into_inner(), design.into_inner()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            design_values
                .iter()
                .copied()
                .map(|value| (value, value))
                .collect()
        });
    if mapping.is_empty() {
        mapping.push((design_default, design_default));
    }
    mapping.sort_by(|left, right| left.0.total_cmp(&right.0));
    mapping.dedup_by(|left, right| left.0 == right.0);
    GlyphsAxisMapping {
        user_to_design: mapping.into_boxed_slice(),
    }
}

pub(crate) fn master_location_values(master: &FontMaster, axis_count: usize) -> Vec<Option<f64>> {
    (0..axis_count)
        .map(|index| {
            master
                .axes_values
                .get(index)
                .map(|value| value.into_inner())
        })
        .collect()
}

pub(crate) fn component_transform(component: &GlyphsComponent) -> [f64; 6] {
    component.transform.as_coeffs()
}

pub(crate) fn missing_component_details(name: &str) -> String {
    format!("component base glyph {name:?} does not exist")
}

pub(crate) fn anchor_parts(anchor: &GlyphsAnchor) -> (Option<String>, f64, f64) {
    (
        (!anchor.name.is_empty()).then(|| anchor.name.to_string()),
        anchor.pos.x,
        anchor.pos.y,
    )
}

pub(crate) fn font_header(
    glyphs_font: &GlyphsFont,
) -> FormatBackendResult<(Font, HashMap<String, SourceId>)> {
    let mut font = Font::empty();

    if let Some(family_name) = glyphs_font.get_default_name("familyNames") {
        font.metadata_mut().family_name = Some(family_name.to_string());
    }
    if let Some(default_master) = glyphs_font.masters.get(glyphs_font.default_master_idx) {
        font.metadata_mut().style_name = Some(default_master.name.clone());
    }
    font.metadata_mut().version_major = Some(glyphs_font.version_major);
    font.metadata_mut().version_minor = Some(glyphs_font.version_minor as i32);
    font.metrics_mut().units_per_em = glyphs_font.units_per_em as f64;

    let mut axis_ids_by_index = Vec::new();
    let mut axis_mappings = Vec::new();
    for (index, glyphs_axis) in glyphs_font.axes.iter().enumerate() {
        let design_values = master_design_values(glyphs_font, index);
        if design_values.is_empty() {
            continue;
        }

        let design_default = default_design_value(glyphs_font, index, &design_values);
        let mapping = glyphs_axis_mapping(glyphs_font, index, &design_values, design_default);
        let user_default = mapping.unmap(design_default);
        let instance_values = glyphs_font
            .instances
            .iter()
            .filter(|instance| instance.active)
            .filter_map(|instance| instance.axes_values.get(index))
            .map(|value| mapping.unmap(value.into_inner()));
        let external_values = mapping
            .user_values()
            .chain(design_values.iter().map(|value| mapping.unmap(*value)))
            .chain(instance_values);
        let (user_minimum, user_maximum) = external_values
            .fold((user_default, user_default), |(minimum, maximum), value| {
                (minimum.min(value), maximum.max(value))
            });
        let mut axis = Axis::new(
            glyphs_axis.tag.clone(),
            glyphs_axis.name.clone(),
            user_minimum,
            user_default,
            user_maximum,
        );
        axis.set_hidden(glyphs_axis.hidden.unwrap_or(false));
        axis_ids_by_index.push(axis.id());
        axis_mappings.push(mapping);
        font.add_axis(axis)?;
    }
    font.set_axis_mappings(
        axis_ids_by_index
            .iter()
            .zip(&axis_mappings)
            .zip(&glyphs_font.axes)
            .map(|((axis_id, mapping), axis)| {
                AxisMapping::new(
                    format!("{} mapping", axis.name),
                    vec![axis_id.clone()],
                    vec![axis_id.clone()],
                    mapping
                        .user_to_design
                        .iter()
                        .map(|(user, design)| AxisMappingPoint {
                            description: None,
                            input: Location::from_map(HashMap::from([(axis_id.clone(), *user)])),
                            output: Location::from_map(HashMap::from([(axis_id.clone(), *design)])),
                        })
                        .collect(),
                )
            })
            .collect(),
    )?;

    let mut source_ids_by_master_id = HashMap::new();
    for (master_index, master) in glyphs_font.masters.iter().enumerate() {
        let mut location = DesignLocation::new();
        for (axis_id, value) in axis_ids_by_index
            .iter()
            .zip(master_location_values(master, axis_ids_by_index.len()))
        {
            if let Some(value) = value {
                location.set(axis_id.clone(), value);
            }
        }
        let source_id = font.add_source(Source::new(master.name.clone(), location));
        let metric_definitions = font.metric_definitions().to_vec();
        let source = font
            .source_mut(source_id.clone())
            .expect("a newly added source should exist");
        set_metric_position(
            &metric_definitions,
            source,
            MetricKind::Ascender,
            master.ascender(),
        );
        set_metric_position(
            &metric_definitions,
            source,
            MetricKind::Descender,
            master.descender(),
        );
        set_metric_position(
            &metric_definitions,
            source,
            MetricKind::CapHeight,
            master.cap_height(),
        );
        set_metric_position(
            &metric_definitions,
            source,
            MetricKind::XHeight,
            master.x_height(),
        );
        source.set_italic_angle(master.italic_angle());
        source_ids_by_master_id.insert(master.id.clone(), source_id.clone());
        if master_index == glyphs_font.default_master_idx {
            font.set_default_source_id(source_id);
        }
    }

    font.set_named_instances(
        glyphs_font
            .instances
            .iter()
            .filter(|instance| instance.active)
            .map(|instance| {
                NamedInstance::new(
                    instance.name.clone(),
                    ExternalLocation::from_map(
                        axis_ids_by_index
                            .iter()
                            .zip(&axis_mappings)
                            .enumerate()
                            .map(|(index, (axis_id, mapping))| {
                                let value = instance
                                    .axes_values
                                    .get(index)
                                    .map(|value| mapping.unmap(value.into_inner()))
                                    .unwrap_or_else(|| font.axes()[index].default());
                                (axis_id.clone(), value)
                            })
                            .collect(),
                    ),
                    None,
                )
            })
            .collect(),
    )?;
    *font.features_mut() = convert_features(glyphs_font);
    *font.kerning_mut() = convert_kerning(glyphs_font);
    Ok((font, source_ids_by_master_id))
}

pub(super) fn imported_layer_count(
    glyph: &GlyphsGlyph,
    source_ids_by_master_id: &HashMap<String, SourceId>,
) -> usize {
    glyph
        .layers
        .iter()
        .filter(|layer| source_ids_by_master_id.contains_key(layer.master_id()))
        .count()
}

pub(super) fn convert_glyph(
    glyph: &GlyphsGlyph,
    glyph_ids: &HashMap<String, GlyphId>,
    source_ids_by_master_id: &HashMap<String, SourceId>,
) -> FormatBackendResult<Glyph> {
    let glyph_id = glyph_ids
        .get(glyph.name.as_str())
        .expect("every Glyphs glyph should have a published identity")
        .clone();
    let mut result = Glyph::with_id(glyph_id, glyph.name.to_string());
    result.set_unicodes(glyph.unicode.iter().copied().collect());

    for layer in &glyph.layers {
        let Some(source_id) = source_ids_by_master_id.get(layer.master_id()).cloned() else {
            continue;
        };

        let mut result_layer =
            GlyphLayer::with_width(LayerId::new(), source_id, layer.width.into_inner());
        for shape in &layer.shapes {
            match shape {
                Shape::Path(path) => {
                    let mut contour = Contour::new();
                    for node in &path.nodes {
                        let (point_type, smooth) = convert_node_type(node.node_type);
                        contour.add_point(node.pt.x, node.pt.y, point_type, smooth);
                    }
                    if path.closed {
                        contour.close();
                    }
                    result_layer.add_contour(contour);
                }
                Shape::Component(component) => {
                    let base_glyph_id =
                        glyph_ids.get(component.name.as_str()).ok_or_else(|| {
                            FormatBackendError::Glyphs(missing_component_details(
                                component.name.as_str(),
                            ))
                        })?;
                    let coeffs = component_transform(component);
                    result_layer.add_component(Component::with_matrix(
                        base_glyph_id.clone(),
                        component.name.to_string(),
                        &Transform {
                            xx: coeffs[0],
                            xy: coeffs[1],
                            yx: coeffs[2],
                            yy: coeffs[3],
                            dx: coeffs[4],
                            dy: coeffs[5],
                        },
                    ));
                }
            }
        }

        for anchor in &layer.anchors {
            let (name, x, y) = anchor_parts(anchor);
            result_layer.add_anchor(Anchor::new(name, x, y));
        }

        result.set_layer(result_layer);
    }

    Ok(result)
}

fn convert_node_type(node_type: NodeType) -> (shift_font::PointType, bool) {
    match node_type {
        NodeType::Line => (shift_font::PointType::OnCurve, false),
        NodeType::LineSmooth => (shift_font::PointType::OnCurve, true),
        NodeType::OffCurve => (shift_font::PointType::OffCurve, false),
        NodeType::Curve => (shift_font::PointType::OnCurve, false),
        NodeType::CurveSmooth => (shift_font::PointType::OnCurve, true),
        NodeType::QCurve => (shift_font::PointType::QCurve, false),
        NodeType::QCurveSmooth => (shift_font::PointType::QCurve, true),
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

    for glyph in font.glyphs.values() {
        if let Some(group) = glyph.right_kern.as_deref() {
            let group_name = format!("{UFO_SIDE1_PREFIX}{group}");
            let mut members = kerning
                .groups1()
                .get(&group_name)
                .cloned()
                .unwrap_or_default();
            members.push(glyph.name.to_string().into());
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
            members.push(glyph.name.to_string().into());
            members.sort();
            members.dedup();
            kerning.set_group2(group_name, members);
        }
    }

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
            KerningSide::Glyph(first.to_string().into())
        };
        let second_side = if let Some(group) = second
            .strip_prefix(GLYPHS_SIDE2_PREFIX)
            .or_else(|| second.strip_prefix(GLYPHS_SIDE1_PREFIX))
        {
            KerningSide::Group(format!("{UFO_SIDE2_PREFIX}{group}"))
        } else {
            KerningSide::Glyph(second.to_string().into())
        };
        kerning.add_pair(KerningPair::new(
            first_side,
            second_side,
            value.into_inner(),
        ));
    }

    kerning
}
