use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use glyphs_reader::{
    Anchor as GlyphsAnchor, FeatureSnippet, Font as GlyphsFont, FontMaster, Glyph as GlyphsGlyph,
    InstanceType, Layer as GlyphsLayer, NodeType, Shape,
};
use ordered_float::OrderedFloat;
use shift_font::{
    Anchor, Axis, AxisMapping, AxisMappingPoint, Component, Contour, DesignLocation,
    ExternalLocation, FeatureData, Font, Glyph, GlyphId, GlyphLayer, Kerning, KerningPosition,
    LayerId, LibValue, Location, NamedInstance, Source, SourceId, StandardMetrics, Transform,
};

use super::families::InstanceFamilies;
use crate::{
    FormatBackendError, FormatBackendResult, ImportLoss, ImportReport, distinct_named_instances,
    feature_includes::inline_feature_includes,
    font_source::piecewise_map,
    glyph_category::{GlyphCategories, ResolvedCategory},
    kerning_import::{KerningImport, NamedKerningSide},
};

const GLYPHS_SIDE1_PREFIX: &str = "@MMK_L_";
const GLYPHS_SIDE2_PREFIX: &str = "@MMK_R_";

/// Whether a Glyphs instance names a design-space location.
///
/// `type = variable` instances carry variable-font export settings and have no
/// `axesValues`, so they would otherwise fall back to the default location and
/// collide with a static instance there.
fn is_named_instance(active: bool, instance_type: &InstanceType) -> bool {
    active && *instance_type == InstanceType::Single
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

    /// Maps a user value to design space, extending the edge segments past
    /// the authored points the way compilers do.
    pub(crate) fn map(&self, user: f64) -> f64 {
        piecewise_map(user, &self.user_to_design)
    }

    /// Adds a point for each of `users` that the mapping doesn't define, at
    /// the design value the mapping already gives it.
    ///
    /// Compilers need explicit points at the axis minimum, default, and
    /// maximum; masters past the authored points otherwise leave them out.
    pub(crate) fn pin(&mut self, users: impl IntoIterator<Item = f64>) {
        let mut points = self.user_to_design.to_vec();
        for user in users {
            if points
                .iter()
                .all(|(existing, _)| (existing - user).abs() > 1e-9)
            {
                points.push((user, self.map(user)));
            }
        }
        points.sort_by(|left, right| left.0.total_cmp(&right.0));
        self.user_to_design = points.into_boxed_slice();
    }

    pub(crate) fn user_values(&self) -> impl Iterator<Item = f64> + '_ {
        self.user_to_design.iter().map(|(user, _)| *user)
    }
}

/// Axis questions about a Glyphs source that glyphs-reader leaves to callers.
pub(crate) trait GlyphsFontExt {
    /// Returns each master's design value on the axis at `axis_index`.
    fn master_design_values(&self, axis_index: usize) -> Vec<f64>;

    /// Returns the default master's design value on the axis, falling back to
    /// the first of `values`.
    fn default_design_value(&self, axis_index: usize, values: &[f64]) -> f64;

    /// Returns the axis's user-to-design mapping, or an identity mapping
    /// through the masters' design values when the source authors none.
    fn axis_mapping(
        &self,
        axis_index: usize,
        design_values: &[f64],
        design_default: f64,
    ) -> GlyphsAxisMapping;
}

impl GlyphsFontExt for GlyphsFont {
    fn master_design_values(&self, axis_index: usize) -> Vec<f64> {
        self.masters
            .iter()
            .filter_map(|master| master.axes_values.get(axis_index))
            .map(|value| value.into_inner())
            .collect()
    }

    fn default_design_value(&self, axis_index: usize, values: &[f64]) -> f64 {
        self.masters
            .get(self.default_master_idx)
            .and_then(|master| master.axes_values.get(axis_index))
            .map(|value| value.into_inner())
            .or_else(|| values.first().copied())
            .unwrap_or(0.0)
    }

    fn axis_mapping(
        &self,
        axis_index: usize,
        design_values: &[f64],
        design_default: f64,
    ) -> GlyphsAxisMapping {
        let axis = &self.axes[axis_index];
        let mut mapping = self.axis_mappings.get(&axis.name).map_or_else(
            || {
                design_values
                    .iter()
                    .copied()
                    .map(|value| (value, value))
                    .collect()
            },
            |mapping| {
                mapping
                    .iter()
                    .map(|(user, design)| (user.into_inner(), design.into_inner()))
                    .collect::<Vec<_>>()
            },
        );
        if mapping.is_empty() {
            mapping.push((design_default, design_default));
        }
        mapping.sort_by(|left, right| left.0.total_cmp(&right.0));
        mapping.dedup_by(|left, right| left.0 == right.0);
        GlyphsAxisMapping {
            user_to_design: mapping.into_boxed_slice(),
        }
    }
}

/// Reads a Glyphs master's location.
pub(crate) trait GlyphsMasterExt {
    /// Returns the master's value on each of the first `axis_count` axes.
    fn location_values(&self, axis_count: usize) -> impl Iterator<Item = Option<f64>>;
}

impl GlyphsMasterExt for FontMaster {
    fn location_values(&self, axis_count: usize) -> impl Iterator<Item = Option<f64>> {
        (0..axis_count).map(|index| self.axes_values.get(index).map(|value| value.into_inner()))
    }
}

/// Reads a Glyphs anchor as Shift stores one.
pub(crate) trait GlyphsAnchorExt {
    /// Returns the anchor's name, `None` when it is blank, and its position.
    fn name_and_position(&self) -> (Option<String>, f64, f64);
}

impl GlyphsAnchorExt for GlyphsAnchor {
    fn name_and_position(&self) -> (Option<String>, f64, f64) {
        (
            (!self.name.is_empty()).then(|| self.name.to_string()),
            self.pos.x,
            self.pos.y,
        )
    }
}

pub(crate) fn missing_component_details(name: &str) -> String {
    format!("component base glyph {name:?} does not exist")
}

pub(crate) fn font_header(
    glyphs_font: &GlyphsFont,
    path: &Path,
    families: &InstanceFamilies,
    losses: &mut Vec<ImportLoss>,
) -> FormatBackendResult<(Font, HashMap<String, SourceId>)> {
    let mut font = Font::empty();

    if let Some(family_name) = glyphs_font.get_default_name("familyNames") {
        font.metadata_mut().family_name = Some(family_name.to_string());
    }
    if let Some(default_master) = glyphs_font.masters.get(glyphs_font.default_master_idx) {
        font.metadata_mut().style_name = Some(default_master.name.clone());
    }
    font.metadata_mut().version_major = Some(glyphs_font.version_major);
    font.metadata_mut().version_minor = i32::try_from(glyphs_font.version_minor).ok();
    font.metrics_mut().units_per_em = glyphs_font.units_per_em as f64;
    let skipped = glyphs_font
        .glyph_order
        .iter()
        .filter(|name| {
            glyphs_font
                .glyphs
                .get(*name)
                .is_some_and(|glyph| !glyph.export)
        })
        .map(|name| LibValue::String(name.to_string()))
        .collect::<Vec<_>>();
    if !skipped.is_empty() {
        font.lib_mut().set(
            shift_font::lib_data::SKIP_EXPORT_GLYPHS.to_string(),
            LibValue::Array(skipped),
        );
    }

    let mut axis_ids_by_index = Vec::new();
    let mut axis_mappings = Vec::new();
    for (index, glyphs_axis) in glyphs_font.axes.iter().enumerate() {
        let design_values = glyphs_font.master_design_values(index);
        if design_values.is_empty() {
            continue;
        }

        let design_default = glyphs_font.default_design_value(index, &design_values);
        let mapping = glyphs_font.axis_mapping(index, &design_values, design_default);
        let user_default = mapping.unmap(design_default);
        let instance_values = glyphs_font
            .instances
            .iter()
            .filter(|instance| is_named_instance(instance.active, &instance.type_))
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
        let mut mapping = mapping;
        mapping.pin([user_minimum, user_default, user_maximum]);
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
                            input: Location::from([(axis_id.clone(), *user)]),
                            output: Location::from([(axis_id.clone(), *design)]),
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
            .zip(master.location_values(axis_ids_by_index.len()))
        {
            if let Some(value) = value {
                location.set(axis_id.clone(), value);
            }
        }
        let source_id = font.add_source(Source::new(master.name.clone(), location));
        font.set_standard_metrics(
            &source_id,
            StandardMetrics {
                ascender: master.ascender(),
                descender: master.descender(),
                cap_height: master.cap_height(),
                x_height: master.x_height(),
                baseline: None,
            },
        )?;
        let source = font
            .source_mut(&source_id)
            .expect("a newly added source should exist");
        source.set_italic_angle(master.italic_angle());
        source_ids_by_master_id.insert(master.id.clone(), source_id.clone());
        if master_index == glyphs_font.default_master_idx {
            font.set_default_source_id(source_id);
        }
    }

    let (instances, loss) = distinct_named_instances(
        glyphs_font
            .instances
            .iter()
            .enumerate()
            .filter(|(index, instance)| {
                is_named_instance(instance.active, &instance.type_) && families.is_own(*index)
            })
            .map(|(_, instance)| {
                NamedInstance::new(
                    instance.name.clone(),
                    ExternalLocation::from_map(
                        axis_ids_by_index
                            .iter()
                            .zip(&axis_mappings)
                            .enumerate()
                            .map(|(index, (axis_id, mapping))| {
                                let value = instance.axes_values.get(index).map_or_else(
                                    || font.axes()[index].default(),
                                    |value| mapping.unmap(value.into_inner()),
                                );
                                (axis_id.clone(), value)
                            }),
                    ),
                    None,
                )
            })
            .collect(),
    );
    losses.extend(loss);
    font.set_named_instances(instances)?;
    *font.features_mut() = convert_features(glyphs_font, path);
    Ok((font, source_ids_by_master_id))
}

/// Glyphs intermediate-layer coordinates, one design value per font axis.
type IntermediateLocation = Vec<OrderedFloat<f64>>;

/// Shift sources that receive imported Glyphs layers.
///
/// Master layers map to their master's source. Each distinct intermediate
/// (brace) layer location maps to one sparse master source. Smart-component
/// pole and draft layers have no source and are not imported.
pub(super) struct GlyphsLayerSources {
    masters: HashMap<String, SourceId>,
    intermediates: HashMap<IntermediateLocation, SourceId>,
}

impl GlyphsLayerSources {
    fn source_id(&self, layer: &GlyphsLayer) -> Option<SourceId> {
        if layer.is_master() {
            return self.masters.get(layer.master_id()).cloned();
        }
        if layer.is_intermediate() {
            return self
                .intermediates
                .get(&layer.attributes.coordinates)
                .cloned();
        }
        None
    }
}

/// Adds one sparse master source per distinct intermediate-layer location.
///
/// Locations that coincide with a master stay unmapped; the import report
/// lists those layers as omitted. Each new source takes the metrics the
/// masters interpolate to at its location, which leaves font-wide metric
/// interpolation unchanged.
pub(super) fn add_intermediate_sources(
    font: &mut Font,
    glyphs_font: &GlyphsFont,
    masters: HashMap<String, SourceId>,
) -> GlyphsLayerSources {
    let master_locations = glyphs_font
        .masters
        .iter()
        .map(|master| master.axes_values.clone())
        .collect::<Vec<_>>();
    let locations = glyphs_font
        .glyphs
        .values()
        .flat_map(|glyph| &glyph.layers)
        .filter(|layer| layer.is_intermediate())
        .map(|layer| layer.attributes.coordinates.clone())
        .filter(|location| !master_locations.contains(location))
        .collect::<BTreeSet<_>>();

    let metrics = font.source_metric_interpolation();
    let mut intermediates = HashMap::new();
    for coordinates in locations {
        let location: DesignLocation = font
            .axes()
            .iter()
            .zip(&coordinates)
            .map(|(axis, value)| (axis.id(), value.into_inner()))
            .collect();
        let name = coordinates
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        let mut source = Source::new(format!("{{{name}}}"), location.clone());
        if let Some(resolved) = metrics
            .as_ref()
            .and_then(|metrics| metrics.resolve(&location, font.axes()).ok())
        {
            source.set_metric_values(resolved.metric_values().clone());
            source.set_italic_angle(resolved.italic_angle());
            source.set_line_gap(resolved.line_gap());
            source.set_underline_position(resolved.underline_position());
            source.set_underline_thickness(resolved.underline_thickness());
        }
        intermediates.insert(coordinates, font.add_source(source));
    }

    GlyphsLayerSources {
        masters,
        intermediates,
    }
}

pub(super) fn imported_layer_count(glyph: &GlyphsGlyph, sources: &GlyphsLayerSources) -> usize {
    glyph
        .layers
        .iter()
        .filter(|layer| sources.source_id(layer).is_some())
        .count()
}

pub(super) fn convert_glyph(
    glyph: &GlyphsGlyph,
    glyph_ids: &HashMap<String, GlyphId>,
    sources: &GlyphsLayerSources,
) -> FormatBackendResult<Glyph> {
    let glyph_id = glyph_ids
        .get(glyph.name.as_str())
        .expect("every Glyphs glyph should have a published identity")
        .clone();
    let mut result = Glyph::with_id(glyph_id, glyph.name.to_string());
    result.set_unicodes(glyph.unicode.iter().copied().collect());
    // glyphs-reader fills unset categories from glyph data; keep only the
    // ones the file sets differently, so renaming a glyph still updates them.
    let overrides = GlyphCategories::new().overrides(
        glyph.name.as_str(),
        result.unicodes(),
        ResolvedCategory {
            category: glyph
                .category
                .and_then(|category| category.to_string().parse().ok()),
            sub_category: glyph
                .sub_category
                .and_then(|sub_category| sub_category.to_string().parse().ok()),
        },
    );
    result.set_category(overrides.category);
    result.set_sub_category(overrides.sub_category);

    for layer in &glyph.layers {
        let Some(source_id) = sources.source_id(layer) else {
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
                        contour.start_at_first_on_curve();
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
                    result_layer.add_component(Component::with_matrix(
                        base_glyph_id.clone(),
                        component.name.to_string(),
                        &Transform::from_values(component.transform.as_coeffs()),
                    ));
                }
            }
        }

        for anchor in &layer.anchors {
            let (name, x, y) = anchor.name_and_position();
            result_layer.add_anchor(Anchor::new(name, x, y));
        }

        result.set_layer(result_layer);
    }

    Ok(result)
}

fn convert_node_type(node_type: NodeType) -> (shift_font::PointType, bool) {
    match node_type {
        NodeType::Line | NodeType::Curve => (shift_font::PointType::OnCurve, false),
        NodeType::LineSmooth | NodeType::CurveSmooth => (shift_font::PointType::OnCurve, true),
        NodeType::OffCurve => (shift_font::PointType::OffCurve, false),
        NodeType::QCurve => (shift_font::PointType::QCurve, false),
        NodeType::QCurveSmooth => (shift_font::PointType::QCurve, true),
    }
}

/// Joins the enabled feature snippets, inlining includes against the folder
/// holding the `.glyphs` file or package, as fontc does.
fn convert_features(font: &GlyphsFont, path: &Path) -> FeatureData {
    let source = font
        .features
        .iter()
        .filter_map(FeatureSnippet::str_if_enabled)
        .collect::<Vec<_>>()
        .join("\n\n");
    if source.trim().is_empty() {
        FeatureData::new()
    } else {
        FeatureData::from_fea(inline_feature_includes(
            &source,
            path.parent().unwrap_or(path),
        ))
    }
}

/// Converts every master's left-to-right kerning and the glyphs' kerning
/// groups, recording dropped references in `report`.
///
/// A glyph's right kerning group is its group for the first position of a
/// pair, and its left group the one for the second position.
pub(super) fn convert_kerning(
    font: &GlyphsFont,
    glyph_ids: &HashMap<String, GlyphId>,
    source_ids_by_master_id: &HashMap<String, SourceId>,
    report: &mut ImportReport,
) -> Kerning {
    let mut import = KerningImport::new(glyph_ids);
    for glyph in font.glyphs.values() {
        if let Some(group) = glyph.right_kern.as_deref() {
            import.add_group(KerningPosition::First, group, [glyph.name.as_str()]);
        }
        if let Some(group) = glyph.left_kern.as_deref() {
            import.add_group(KerningPosition::Second, group, [glyph.name.as_str()]);
        }
    }

    for master in &font.masters {
        let (Some(source_id), Some(pairs)) = (
            source_ids_by_master_id.get(&master.id),
            font.kerning_ltr.get(&master.id),
        ) else {
            continue;
        };
        for ((first, second), value) in pairs {
            import.add_pair(
                source_id,
                named_kerning_side(first),
                named_kerning_side(second),
                value.into_inner(),
            );
        }
    }

    import.finish(report)
}

fn named_kerning_side(name: &str) -> NamedKerningSide<'_> {
    match name
        .strip_prefix(GLYPHS_SIDE1_PREFIX)
        .or_else(|| name.strip_prefix(GLYPHS_SIDE2_PREFIX))
    {
        Some(group) => NamedKerningSide::Group(group),
        None => NamedKerningSide::Glyph(name),
    }
}

#[cfg(test)]
mod tests {
    use glyphs_reader::LayerAttributes;
    use ordered_float::OrderedFloat;

    use super::*;

    fn layer(layer_id: &str, master_id: Option<&str>, coordinates: &[f64]) -> GlyphsLayer {
        GlyphsLayer {
            layer_id: layer_id.to_string(),
            associated_master_id: master_id.map(ToString::to_string),
            attributes: LayerAttributes {
                coordinates: coordinates.iter().copied().map(OrderedFloat).collect(),
                ..LayerAttributes::default()
            },
            ..GlyphsLayer::default()
        }
    }

    #[test]
    fn intermediate_layers_import_into_one_source_per_location() {
        let mut font = Font::new();
        let axis = Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis).unwrap();
        let master_source_id = font.default_source_id().unwrap();

        let mut glyphs_font = GlyphsFont::default();
        for name in ["a", "b"] {
            glyphs_font.glyphs.insert(
                name.into(),
                GlyphsGlyph {
                    name: name.into(),
                    layers: vec![
                        layer("m01", None, &[]),
                        layer("brace", Some("m01"), &[155.0]),
                        layer("draft", Some("m01"), &[]),
                    ],
                    ..GlyphsGlyph::default()
                },
            );
        }
        let sources = add_intermediate_sources(
            &mut font,
            &glyphs_font,
            HashMap::from([("m01".to_string(), master_source_id.clone())]),
        );
        let glyph_ids = HashMap::from([
            ("a".to_string(), GlyphId::new()),
            ("b".to_string(), GlyphId::new()),
        ]);

        let a = convert_glyph(&glyphs_font.glyphs["a"], &glyph_ids, &sources).unwrap();
        let b = convert_glyph(&glyphs_font.glyphs["b"], &glyph_ids, &sources).unwrap();

        let brace = font
            .sources()
            .iter()
            .find(|source| source.name() == "{155}")
            .unwrap();
        assert!(brace.is_master());
        assert_eq!(brace.location().get(&axis_id), Some(155.0));
        assert_eq!(imported_layer_count(&glyphs_font.glyphs["a"], &sources), 2);
        for glyph in [&a, &b] {
            assert_eq!(glyph.layers().len(), 2);
            assert!(glyph.layer_for_source(&master_source_id).is_some());
            assert!(glyph.layer_for_source(&brace.id()).is_some());
        }
    }

    #[test]
    fn a_master_past_the_authored_mapping_gets_a_point_at_the_axis_end() {
        // Signika: the mapping stops at user 600 / design 269, while the
        // Bold master sits at design 321.
        let mut mapping = GlyphsAxisMapping {
            user_to_design: vec![(300.0, 154.0), (400.0, 213.0), (600.0, 269.0)].into_boxed_slice(),
        };
        let user_maximum = mapping.unmap(321.0);

        mapping.pin([300.0, 300.0, user_maximum]);

        assert_eq!(user_maximum, 652.0);
        assert_eq!(mapping.user_to_design.last(), Some(&(652.0, 321.0)));
        assert_eq!(mapping.user_to_design.len(), 4);
    }
}
