use super::error::{DesignspaceError, DesignspaceResult};
use crate::errors::FormatBackendResult;
use crate::font_source::{piecewise_map, VariationAxisKind};
use crate::import::collect_streamed_font;
use crate::traits::FontReader;
use norad::designspace::DesignSpaceDocument;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use shift_font::{
    Axis, AxisId, AxisMapping, AxisMappingId, AxisMappingPoint, DesignLocation, ExternalLocation,
    Font, Location, NamedInstance,
};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub struct DesignspaceReader;

impl DesignspaceReader {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DesignspaceReader {
    fn default() -> Self {
        Self::new()
    }
}

impl FontReader for DesignspaceReader {
    fn load(&self, path: &str) -> FormatBackendResult<Font> {
        self.load_designspace(path)
    }
}

impl DesignspaceReader {
    fn load_designspace(&self, path: &str) -> FormatBackendResult<Font> {
        let (header, mut stream) = super::stream_font(path)?;
        collect_streamed_font(header, &mut stream)
    }
}

pub(super) fn named_instances_from_designspace(
    doc: &DesignSpaceDocument,
    axes: &[Axis],
) -> DesignspaceResult<Vec<NamedInstance>> {
    let mut imported = Vec::new();
    for (index, instance) in doc.instances.iter().enumerate() {
        // Legacy Designspace instances can also describe anisotropic or
        // extrapolated static-export recipes. Shift named instances are
        // variable-font presets, so only retain locations that fit that model.
        if instance.location.iter().any(|dimension| {
            dimension
                .yvalue
                .is_some_and(|y| dimension.xvalue != Some(y))
        }) {
            continue;
        }

        let name = instance
            .stylename
            .clone()
            .or_else(|| instance.name.clone())
            .unwrap_or_else(|| format!("Instance {}", index + 1));
        let location = external_location_from_dimensions(&instance.location, doc, axes)?;
        let postscript_name = instance.postscriptfontname.clone().filter(|name| {
            !imported
                .iter()
                .any(|existing: &NamedInstance| existing.postscript_name() == Some(name))
        });
        let candidate = NamedInstance::new(name, location, postscript_name);

        if candidate.validate(axes).is_err()
            || imported.iter().any(|existing: &NamedInstance| {
                existing.name() == candidate.name() || existing.location() == candidate.location()
            })
        {
            continue;
        }
        imported.push(candidate);
    }

    Ok(imported)
}

fn external_location_from_dimensions(
    dimensions: &[norad::designspace::Dimension],
    doc: &DesignSpaceDocument,
    axes: &[Axis],
) -> DesignspaceResult<ExternalLocation> {
    let mut location = ExternalLocation::new();
    for ds_axis in &doc.axes {
        let Some(axis) = axes.iter().find(|axis| axis.tag() == ds_axis.tag) else {
            continue;
        };
        let value = match dimensions
            .iter()
            .find(|dimension| dimension.name == ds_axis.name)
        {
            Some(dimension) => match (dimension.xvalue, dimension.uservalue) {
                (Some(value), _) => unmap_axis_value(ds_axis, value as f64),
                (None, Some(value)) => value as f64,
                (None, None) => axis.default(),
            },
            None => axis.default(),
        };
        location.set(axis.id(), value);
    }

    Ok(location)
}

// Matches designspaceLib's continuous and discrete `map_backward` behavior.
// Continuous flat segments choose the first user value; discrete maps only
// replace exact authored values.
// https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.AxisDescriptor.map_backward
fn unmap_axis_value(axis: &norad::designspace::Axis, value: f64) -> f64 {
    let Some(map) = axis.map.as_ref().filter(|map| !map.is_empty()) else {
        return value;
    };

    if axis.values.is_some() {
        return map
            .iter()
            .find(|point| point.output as f64 == value)
            .map(|point| point.input as f64)
            .unwrap_or(value);
    }

    let mut points = map
        .iter()
        .map(|point| (point.output as f64, point.input as f64))
        .collect::<Vec<_>>();
    points.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.total_cmp(&right.1))
    });

    let (first_design, first_user) = points[0];
    if value <= first_design {
        return value + first_user - first_design;
    }
    for pair in points.windows(2) {
        let (lower_design, lower_user) = pair[0];
        let (upper_design, upper_user) = pair[1];
        if lower_design <= value && value <= upper_design {
            if lower_design == upper_design {
                return lower_user;
            }

            return lower_user
                + (upper_user - lower_user) * (value - lower_design)
                    / (upper_design - lower_design);
        }
    }

    let (last_design, last_user) = points[points.len() - 1];
    value + last_user - last_design
}

pub(crate) fn axis_mappings_from_designspace(
    doc: &DesignSpaceDocument,
    axes: &[Axis],
) -> DesignspaceResult<Vec<AxisMapping>> {
    let axes_by_name = axes
        .iter()
        .map(|axis| (axis.name(), axis.id()))
        .collect::<HashMap<_, _>>();
    let mut mappings = Vec::new();

    for ds_axis in &doc.axes {
        let Some(ds_points) = &ds_axis.map else {
            continue;
        };
        let Some(axis_id) = axes_by_name.get(ds_axis.name.as_str()).cloned() else {
            continue;
        };
        let points = ds_points
            .iter()
            .map(|point| AxisMappingPoint {
                description: None,
                input: singleton_location(axis_id.clone(), point.input as f64),
                output: singleton_location(axis_id.clone(), point.output as f64),
            })
            .collect();
        mappings.push(AxisMapping::with_id(
            AxisMappingId::new(),
            format!("{} mapping", ds_axis.name),
            vec![axis_id.clone()],
            vec![axis_id],
            points,
        ));
    }

    if let Some(group) = &doc.axis_mappings {
        let mut inputs = Vec::new();
        let mut outputs = Vec::new();
        let mut points = Vec::new();
        for entry in &group.mappings {
            let input = mapping_location_from_dimensions(&entry.input, &axes_by_name)?;
            let output = mapping_location_from_dimensions(&entry.output, &axes_by_name)?;
            extend_axis_ids(&mut inputs, &input);
            extend_axis_ids(&mut outputs, &output);
            points.push(AxisMappingPoint {
                description: entry.description.clone(),
                input,
                output,
            });
        }

        if !points.is_empty() {
            let name = group
                .description
                .clone()
                .unwrap_or_else(|| "Cross-axis mapping".to_string());
            let mut mapping =
                AxisMapping::with_id(AxisMappingId::new(), name, inputs, outputs, points);
            mapping.set_description(group.description.clone());
            mappings.push(mapping);
        }
    }

    Ok(mappings)
}

fn mapping_location_from_dimensions(
    dimensions: &[norad::designspace::Dimension],
    axes_by_name: &HashMap<&str, AxisId>,
) -> DesignspaceResult<Location> {
    let mut location = Location::new();
    for dimension in dimensions {
        let Some(axis_id) = axes_by_name.get(dimension.name.as_str()) else {
            return Err(DesignspaceError::LoadDesignspace {
                path: std::path::PathBuf::new(),
                details: format!("mapping references unknown axis {:?}", dimension.name),
            });
        };
        let Some(value) = dimension.xvalue.or(dimension.uservalue) else {
            continue;
        };
        location.set(axis_id.clone(), value as f64);
    }
    Ok(location)
}

fn singleton_location(axis_id: AxisId, value: f64) -> Location {
    let mut location = Location::new();
    location.set(axis_id, value);
    location
}

fn extend_axis_ids(target: &mut Vec<AxisId>, location: &Location) {
    let existing = target.iter().cloned().collect::<HashSet<_>>();
    target.extend(
        location
            .iter()
            .map(|(axis_id, _)| axis_id.clone())
            .filter(|axis_id| !existing.contains(axis_id)),
    );
}

#[derive(Clone, Debug)]
pub(super) struct AxislessSource {
    pub(super) filename: String,
    pub(super) familyname: Option<String>,
    pub(super) stylename: Option<String>,
    pub(super) name: Option<String>,
    pub(super) layer: Option<String>,
}

pub(super) fn axisless_source_name(
    source: &AxislessSource,
    ufo_style_name: Option<&str>,
    used_names: &HashSet<String>,
    index: usize,
) -> String {
    imported_source_name(
        source.name.as_deref(),
        source.stylename.as_deref(),
        ufo_style_name,
        &source.filename,
        used_names,
        index,
    )
}

pub(super) fn parse_axisless_sources(xml: &str) -> DesignspaceResult<Vec<AxislessSource>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut sources = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => match event.name().as_ref() {
                b"axis" => {
                    return Err(DesignspaceError::AxislessNotApplicable {
                        reason: "axes are present".to_string(),
                    })
                }
                b"source" => {
                    if let Some(filename) = xml_attr(&reader, &event, b"filename")? {
                        sources.push(AxislessSource {
                            filename,
                            familyname: xml_attr(&reader, &event, b"familyname")?,
                            stylename: xml_attr(&reader, &event, b"stylename")?,
                            name: xml_attr(&reader, &event, b"name")?,
                            layer: xml_attr(&reader, &event, b"layer")?,
                        });
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(DesignspaceError::ParseAxislessXml {
                    details: error.to_string(),
                })
            }
            _ => {}
        }
    }

    Ok(sources)
}

fn xml_attr(
    reader: &Reader<&[u8]>,
    event: &BytesStart,
    name: &[u8],
) -> DesignspaceResult<Option<String>> {
    for attribute in event.attributes() {
        let attribute = attribute.map_err(|error| DesignspaceError::ParseAxislessXml {
            details: error.to_string(),
        })?;
        if attribute.key.as_ref() == name {
            return attribute
                .decode_and_unescape_value(reader.decoder())
                .map(|value| Some(value.into_owned()))
                .map_err(|error| DesignspaceError::ParseAxislessXml {
                    details: error.to_string(),
                });
        }
    }

    Ok(None)
}

pub(crate) fn source_name(
    source: &norad::designspace::Source,
    ufo_style_name: Option<&str>,
    used_names: &HashSet<String>,
    index: usize,
) -> String {
    imported_source_name(
        source.name.as_deref(),
        source.stylename.as_deref(),
        ufo_style_name,
        &source.filename,
        used_names,
        index,
    )
}

fn imported_source_name(
    designspace_name: Option<&str>,
    designspace_style_name: Option<&str>,
    ufo_style_name: Option<&str>,
    filename: &str,
    used_names: &HashSet<String>,
    index: usize,
) -> String {
    // Source names and style names are optional in Designspace. The backing
    // UFO is therefore the next authoritative naming source, followed by the
    // required filename.
    // https://fonttools.readthedocs.io/en/latest/designspaceLib/xml.html#source-element
    let filename_stem = Path::new(filename)
        .file_stem()
        .and_then(|stem| stem.to_str());
    for candidate in [
        designspace_name,
        designspace_style_name,
        ufo_style_name,
        filename_stem,
    ]
    .into_iter()
    .flatten()
    .filter(|candidate| !candidate.trim().is_empty())
    {
        if !used_names.contains(candidate) {
            return candidate.to_string();
        }
    }

    let base = format!("Source {index}");
    if !used_names.contains(&base) {
        return base;
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{base} {suffix}");
        if !used_names.contains(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

pub(super) fn location_from_dimensions(
    dimensions: &[norad::designspace::Dimension],
    doc: &DesignSpaceDocument,
    axes: &[Axis],
) -> DesignLocation {
    let mut location = DesignLocation::new();
    for ds_axis in &doc.axes {
        let Some(axis) = axes.iter().find(|candidate| candidate.tag() == ds_axis.tag) else {
            continue;
        };

        location.set(axis.id(), source_axis_design_value(dimensions, ds_axis));
    }
    location
}

// Designspace source locations are partial design-space locations. Missing
// dimensions resolve to the axis default after mapping from user space.
// https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.SourceDescriptor.getFullDesignLocation
pub(crate) fn source_axis_design_value(
    dimensions: &[norad::designspace::Dimension],
    axis: &norad::designspace::Axis,
) -> f64 {
    let dimension = dimensions
        .iter()
        .find(|dimension| dimension.name == axis.name);

    match dimension {
        Some(dimension) => match (dimension.xvalue, dimension.uservalue) {
            (Some(value), _) => value as f64,
            (None, Some(value)) => map_axis_value(axis, value as f64),
            (None, None) => map_axis_value(axis, axis.default as f64),
        },
        None => map_axis_value(axis, axis.default as f64),
    }
}

pub(crate) fn map_axis_value(axis: &norad::designspace::Axis, user_value: f64) -> f64 {
    let Some(mapping) = axis.map.as_ref().filter(|mapping| !mapping.is_empty()) else {
        return user_value;
    };

    if axis.values.is_some() {
        return mapping
            .iter()
            .find(|point| point.input as f64 == user_value)
            .map(|point| point.output as f64)
            .unwrap_or(user_value);
    }

    let mut points = mapping
        .iter()
        .map(|point| (point.input as f64, point.output as f64))
        .collect::<Vec<_>>();
    points.sort_by(|left, right| left.0.total_cmp(&right.0));

    piecewise_map(user_value, &points)
}

// This mirrors designspaceLib's findDefault semantics: compare complete
// design-space locations to the mapped user-space defaults. Layer-backed
// sources remain eligible because `layer` describes storage, not source role.
// https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.DesignSpaceDocument.findDefault
pub(crate) fn find_default_source_index(doc: &DesignSpaceDocument) -> Option<usize> {
    doc.sources.iter().position(|source| {
        doc.axes.iter().all(|axis| {
            let source_value = source_axis_design_value(&source.location, axis);
            let default_value = map_axis_value(axis, axis.default as f64);
            design_values_equal(source_value, default_value)
        })
    })
}

fn design_values_equal(left: f64, right: f64) -> bool {
    let scale = left.abs().max(right.abs()).max(1.0);
    (left - right).abs() <= f64::from(f32::EPSILON) * scale * 4.0
}

pub(crate) fn variation_axis_kind(axis: &norad::designspace::Axis) -> VariationAxisKind {
    if let Some(values) = &axis.values {
        let mut values = values
            .iter()
            .map(|value| f64::from(*value))
            .collect::<Vec<_>>();
        values.sort_by(f64::total_cmp);
        values.dedup();
        return VariationAxisKind::Discrete {
            values: values.into_boxed_slice(),
            default: f64::from(axis.default),
        };
    }

    let (minimum, maximum) = derive_axis_range(axis);
    VariationAxisKind::Continuous {
        minimum,
        default: f64::from(axis.default),
        maximum,
    }
}

/// Derive (minimum, maximum) for an axis from norad's parsed designspace.
///
/// Designspace axis edge cases handled:
/// - **Continuous** (both min/max present): use as-is.
/// - **Discrete** (`values="0 1"` with no min/max attrs): min/max are the
///   smallest/largest values in the list. e.g. `ital`, our `SLAB`.
/// - **One-sided** (only min OR max specified): the missing side falls back
///   to `default`. Common with slant axes (`min=-15, default=0, max=0`).
/// - **Degenerate** (no min/max/values): all three collapse to default.
pub(crate) fn derive_axis_range(ds_axis: &norad::designspace::Axis) -> (f64, f64) {
    let values_range = || {
        ds_axis
            .values
            .as_ref()
            .filter(|v| !v.is_empty())
            .map(|values| {
                let min = values.iter().cloned().fold(f32::INFINITY, f32::min) as f64;
                let max = values.iter().cloned().fold(f32::NEG_INFINITY, f32::max) as f64;
                (min, max)
            })
    };

    match (ds_axis.minimum, ds_axis.maximum) {
        (Some(min), Some(max)) => (min as f64, max as f64),
        (None, None) => values_range().unwrap_or((ds_axis.default as f64, ds_axis.default as f64)),
        (Some(min), None) => (min as f64, ds_axis.default as f64),
        (None, Some(max)) => (ds_axis.default as f64, max as f64),
    }
}

#[cfg(test)]
mod axis_range_tests {
    use super::*;
    use norad::designspace::{Axis as DsAxis, AxisMapping as DsAxisMapping, Source as DsSource};

    fn axis(min: Option<f32>, max: Option<f32>, default: f32, values: Option<Vec<f32>>) -> DsAxis {
        DsAxis {
            name: "test".into(),
            tag: "TEST".into(),
            minimum: min,
            maximum: max,
            default,
            hidden: false,
            values,
            ..Default::default()
        }
    }

    #[test]
    fn continuous_uses_explicit_min_max() {
        let a = axis(Some(100.0), Some(900.0), 400.0, None);
        assert_eq!(derive_axis_range(&a), (100.0, 900.0));
    }

    #[test]
    fn mapped_design_values_are_inverted_to_external_values() {
        let mut axis = axis(Some(100.0), Some(900.0), 400.0, None);
        axis.name = "Weight".to_string();
        axis.map = Some(vec![
            norad::designspace::AxisMapping {
                input: 100.0,
                output: 100.0,
            },
            norad::designspace::AxisMapping {
                input: 300.0,
                output: 260.0,
            },
            norad::designspace::AxisMapping {
                input: 400.0,
                output: 420.0,
            },
            norad::designspace::AxisMapping {
                input: 900.0,
                output: 900.0,
            },
        ]);

        assert_eq!(unmap_axis_value(&axis, 260.0), 300.0);
        assert_eq!(unmap_axis_value(&axis, 420.0), 400.0);
    }

    #[test]
    fn discrete_axis_mapping_uses_exact_values_without_interpolation() {
        let mut axis = axis(None, None, 0.0, Some(vec![0.0, 1.0]));
        axis.map = Some(vec![
            DsAxisMapping {
                input: 0.0,
                output: 0.0,
            },
            DsAxisMapping {
                input: 1.0,
                output: -11.0,
            },
        ]);

        assert_eq!(map_axis_value(&axis, 1.0), -11.0);
        assert_eq!(unmap_axis_value(&axis, -11.0), 1.0);
        assert_eq!(map_axis_value(&axis, 0.5), 0.5);
        assert_eq!(unmap_axis_value(&axis, -5.5), -5.5);
    }

    #[test]
    fn discrete_two_values_derives_range() {
        // SLAB axis pattern: <axis values="0 1" default="0"/>
        let a = axis(None, None, 0.0, Some(vec![0.0, 1.0]));
        assert_eq!(derive_axis_range(&a), (0.0, 1.0));
    }

    #[test]
    fn discrete_three_values_derives_range_from_extremes() {
        let a = axis(None, None, 1.0, Some(vec![0.5, 1.0, 1.5]));
        assert_eq!(derive_axis_range(&a), (0.5, 1.5));
    }

    #[test]
    fn discrete_unsorted_values_still_finds_extremes() {
        let a = axis(None, None, 1.0, Some(vec![1.5, 0.5, 1.0]));
        assert_eq!(derive_axis_range(&a), (0.5, 1.5));
    }

    #[test]
    fn explicit_min_max_takes_precedence_over_values() {
        let a = axis(Some(0.0), Some(2.0), 1.0, Some(vec![0.5, 1.5]));
        assert_eq!(derive_axis_range(&a), (0.0, 2.0));
    }

    #[test]
    fn one_sided_min_only_falls_back_to_default_for_max() {
        // slant-like, half-spec'd: min=-15, default=0, no max attr
        let a = axis(Some(-15.0), None, 0.0, None);
        assert_eq!(derive_axis_range(&a), (-15.0, 0.0));
    }

    #[test]
    fn one_sided_max_only_falls_back_to_default_for_min() {
        let a = axis(None, Some(900.0), 400.0, None);
        assert_eq!(derive_axis_range(&a), (400.0, 900.0));
    }

    #[test]
    fn no_min_max_no_values_collapses_to_default() {
        let a = axis(None, None, 400.0, None);
        assert_eq!(derive_axis_range(&a), (400.0, 400.0));
    }

    #[test]
    fn empty_values_list_collapses_to_default() {
        let a = axis(None, None, 0.0, Some(vec![]));
        assert_eq!(derive_axis_range(&a), (0.0, 0.0));
    }

    #[test]
    fn absent_default_source_is_not_replaced_by_the_first_source() {
        let weight = axis(Some(100.0), Some(900.0), 400.0, None);
        let source = DsSource {
            filename: "Bold.ufo".to_string(),
            location: vec![norad::designspace::Dimension {
                name: "test".to_string(),
                xvalue: Some(900.0),
                ..Default::default()
            }],
            ..Default::default()
        };
        let document = DesignSpaceDocument {
            format: 5.0,
            axes: vec![weight],
            sources: vec![source],
            ..Default::default()
        };

        assert_eq!(find_default_source_index(&document), None);
    }

    #[test]
    fn asymmetric_default_at_minimum() {
        // Older fonts where the Light is the default
        let a = axis(Some(400.0), Some(900.0), 400.0, None);
        assert_eq!(derive_axis_range(&a), (400.0, 900.0));
        // The Axis itself should still normalise sensibly:
        let axis = Axis::new("wght".into(), "Weight".into(), 400.0, 400.0, 900.0);
        assert_eq!(axis.normalize(400.0), 0.0);
        assert_eq!(axis.normalize(900.0), 1.0);
        // Below default: range is zero, must return 0 (no negative ramp).
        assert_eq!(axis.normalize(100.0), 0.0);
    }

    #[test]
    fn asymmetric_one_sided_negative_axis() {
        // slnt-like: min=-15, default=0, max=0
        let axis = Axis::new("slnt".into(), "Slant".into(), -15.0, 0.0, 0.0);
        assert_eq!(axis.normalize(0.0), 0.0);
        assert_eq!(axis.normalize(-15.0), -1.0);
        // Above default: range is zero, returns 0 (no positive ramp).
        assert_eq!(axis.normalize(5.0), 0.0);
    }
}
