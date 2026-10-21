use super::DesignspaceAxisExt;
use super::error::{DesignspaceError, DesignspaceResult};
use crate::errors::FormatBackendResult;
use crate::import::collect_streamed_font;
use crate::traits::FontReader;
use norad::designspace::DesignSpaceDocument;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
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
        Self::load_designspace(path)
    }
}

impl DesignspaceReader {
    fn load_designspace(path: &str) -> FormatBackendResult<Font> {
        let (header, mut stream, _report) = super::stream_font(path)?;
        collect_streamed_font(header, &mut stream)
    }
}

pub(super) fn named_instances_from_designspace(
    doc: &DesignSpaceDocument,
    axes: &[Axis],
) -> Vec<NamedInstance> {
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
        let location = external_location_from_dimensions(&instance.location, doc, axes);
        let postscript_name = instance.postscriptfontname.clone().filter(|name| {
            !imported
                .iter()
                .any(|existing: &NamedInstance| existing.postscript_name() == Some(name))
        });
        let candidate = NamedInstance::new(name, location, postscript_name);

        // Two instances at one location are kept here, so the import can
        // report the later one when it leaves it out.
        if candidate.validate(axes).is_err() {
            continue;
        }
        imported.push(candidate);
    }

    imported
}

fn external_location_from_dimensions(
    dimensions: &[norad::designspace::Dimension],
    doc: &DesignSpaceDocument,
    axes: &[Axis],
) -> ExternalLocation {
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
                (Some(value), _) => ds_axis.map_backward(value as f64),
                (None, Some(value)) => value as f64,
                (None, None) => axis.default(),
            },
            None => axis.default(),
        };
        location.set(axis.id(), value);
    }

    location
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
    Location::from([(axis_id, value)])
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
            Ok(Event::Start(event) | Event::Empty(event)) => match event.name().as_ref() {
                "axis" => {
                    return Err(DesignspaceError::AxislessNotApplicable {
                        reason: "axes are present".to_string(),
                    });
                }
                "source" => {
                    if let Some(filename) = xml_attr(&event, "filename")? {
                        sources.push(AxislessSource {
                            filename,
                            familyname: xml_attr(&event, "familyname")?,
                            stylename: xml_attr(&event, "stylename")?,
                            name: xml_attr(&event, "name")?,
                            layer: xml_attr(&event, "layer")?,
                        });
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(DesignspaceError::ParseAxislessXml {
                    details: error.to_string(),
                });
            }
            _ => {}
        }
    }

    Ok(sources)
}

fn xml_attr(event: &BytesStart, name: &str) -> DesignspaceResult<Option<String>> {
    for attribute in event.attributes() {
        let attribute = attribute.map_err(|error| DesignspaceError::ParseAxislessXml {
            details: error.to_string(),
        })?;
        if attribute.key.as_ref() == name {
            return attribute
                .normalized_value(XmlVersion::Implicit1_0)
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

        location.set(axis.id(), ds_axis.design_value_in(dimensions));
    }
    location
}

#[cfg(test)]
mod axis_range_tests {
    use super::super::DesignspaceDocumentExt;
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
        assert_eq!(a.user_range(), (100.0, 900.0));
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

        assert_eq!(axis.map_backward(260.0), 300.0);
        assert_eq!(axis.map_backward(420.0), 400.0);
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

        assert_eq!(axis.map_forward(1.0), -11.0);
        assert_eq!(axis.map_backward(-11.0), 1.0);
        assert_eq!(axis.map_forward(0.5), 0.5);
        assert_eq!(axis.map_backward(-5.5), -5.5);
    }

    #[test]
    fn discrete_two_values_derives_range() {
        // SLAB axis pattern: <axis values="0 1" default="0"/>
        let a = axis(None, None, 0.0, Some(vec![0.0, 1.0]));
        assert_eq!(a.user_range(), (0.0, 1.0));
    }

    #[test]
    fn discrete_three_values_derives_range_from_extremes() {
        let a = axis(None, None, 1.0, Some(vec![0.5, 1.0, 1.5]));
        assert_eq!(a.user_range(), (0.5, 1.5));
    }

    #[test]
    fn discrete_unsorted_values_still_finds_extremes() {
        let a = axis(None, None, 1.0, Some(vec![1.5, 0.5, 1.0]));
        assert_eq!(a.user_range(), (0.5, 1.5));
    }

    #[test]
    fn explicit_min_max_takes_precedence_over_values() {
        let a = axis(Some(0.0), Some(2.0), 1.0, Some(vec![0.5, 1.5]));
        assert_eq!(a.user_range(), (0.0, 2.0));
    }

    #[test]
    fn one_sided_min_only_falls_back_to_default_for_max() {
        // slant-like, half-spec'd: min=-15, default=0, no max attr
        let a = axis(Some(-15.0), None, 0.0, None);
        assert_eq!(a.user_range(), (-15.0, 0.0));
    }

    #[test]
    fn one_sided_max_only_falls_back_to_default_for_min() {
        let a = axis(None, Some(900.0), 400.0, None);
        assert_eq!(a.user_range(), (400.0, 900.0));
    }

    #[test]
    fn no_min_max_no_values_collapses_to_default() {
        let a = axis(None, None, 400.0, None);
        assert_eq!(a.user_range(), (400.0, 400.0));
    }

    #[test]
    fn empty_values_list_collapses_to_default() {
        let a = axis(None, None, 0.0, Some(vec![]));
        assert_eq!(a.user_range(), (0.0, 0.0));
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

        assert_eq!(document.default_source_index(), None);
    }

    #[test]
    fn asymmetric_default_at_minimum() {
        // Older fonts where the Light is the default
        let a = axis(Some(400.0), Some(900.0), 400.0, None);
        assert_eq!(a.user_range(), (400.0, 900.0));
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
