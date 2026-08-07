use super::error::{DesignspaceError, DesignspaceResult};
use quick_xml::events::{BytesEnd, BytesStart, Event};
use quick_xml::{Reader, Writer};
use shift_font::{Axis, AxisLabel, AxisLabelRange};
use std::collections::HashMap;

pub(super) fn parse(xml: &str) -> DesignspaceResult<HashMap<String, Vec<AxisLabel>>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut current_axis = None;
    let mut in_axis_labels = false;
    let mut labels = HashMap::<String, Vec<AxisLabel>>::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"axis" => current_axis = attribute(&reader, &event, b"name")?,
                b"labels" if current_axis.is_some() => in_axis_labels = true,
                b"label" if in_axis_labels => {
                    push_label(&reader, &event, current_axis.as_deref(), &mut labels)?;
                }
                _ => {}
            },
            Ok(Event::Empty(event)) if event.name().as_ref() == b"label" && in_axis_labels => {
                push_label(&reader, &event, current_axis.as_deref(), &mut labels)?;
            }
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"labels" if current_axis.is_some() => in_axis_labels = false,
                b"axis" => {
                    current_axis = None;
                    in_axis_labels = false;
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(parse_error(error)),
            _ => {}
        }
    }

    Ok(labels)
}

pub(super) fn insert(xml: &str, axes: &[Axis]) -> DesignspaceResult<Vec<u8>> {
    let labels = axes
        .iter()
        .filter(|axis| !axis.labels().is_empty())
        .map(|axis| (axis.name(), axis.labels()))
        .collect::<HashMap<_, _>>();
    if labels.is_empty() {
        return Ok(xml.as_bytes().to_vec());
    }

    let mut reader = Reader::from_str(xml);
    let mut writer = Writer::new_with_indent(Vec::new(), b' ', 2);
    let mut current_labels = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) if event.name().as_ref() == b"axis" => {
                current_labels = attribute(&reader, &event, b"name")?
                    .and_then(|name| labels.get(name.as_str()).copied());
                write_event(&mut writer, Event::Start(event))?;
            }
            Ok(Event::Empty(event)) if event.name().as_ref() == b"axis" => {
                let axis_labels = attribute(&reader, &event, b"name")?
                    .and_then(|name| labels.get(name.as_str()).copied());
                if let Some(axis_labels) = axis_labels {
                    write_event(&mut writer, Event::Start(event.into_owned()))?;
                    write_labels(&mut writer, axis_labels)?;
                    write_event(&mut writer, Event::End(BytesEnd::new("axis")))?;
                } else {
                    write_event(&mut writer, Event::Empty(event))?;
                }
            }
            Ok(Event::End(event)) if event.name().as_ref() == b"axis" => {
                if let Some(axis_labels) = current_labels.take() {
                    write_labels(&mut writer, axis_labels)?;
                }
                write_event(&mut writer, Event::End(event))?;
            }
            Ok(Event::Eof) => break,
            Ok(event) => write_event(&mut writer, event)?,
            Err(error) => return Err(parse_error(error)),
        }
    }

    Ok(writer.into_inner())
}

fn push_label(
    reader: &Reader<&[u8]>,
    event: &BytesStart,
    axis_name: Option<&str>,
    labels: &mut HashMap<String, Vec<AxisLabel>>,
) -> DesignspaceResult<()> {
    let axis_name = axis_name.ok_or_else(|| DesignspaceError::ParseDesignspaceXml {
        details: "axis label is not nested in an axis".to_string(),
    })?;
    let name = required_attribute(reader, event, b"name")?;
    let value = number_attribute(reader, event, b"uservalue")?.ok_or_else(|| {
        DesignspaceError::ParseDesignspaceXml {
            details: format!("axis label {name:?} has no uservalue"),
        }
    })?;
    let minimum = number_attribute(reader, event, b"userminimum")?;
    let maximum = number_attribute(reader, event, b"usermaximum")?;
    let range = match (minimum, maximum) {
        (None, None) => None,
        (Some(minimum), Some(maximum)) => Some(AxisLabelRange { minimum, maximum }),
        _ => {
            return Err(DesignspaceError::ParseDesignspaceXml {
                details: format!(
                    "axis label {name:?} must provide both userminimum and usermaximum"
                ),
            })
        }
    };
    let linked_value = number_attribute(reader, event, b"linkeduservalue")?;
    let elidable = attribute(reader, event, b"elidable")?
        .is_some_and(|value| matches!(value.as_str(), "true" | "1"));

    labels
        .entry(axis_name.to_string())
        .or_default()
        .push(AxisLabel::new(name, value, range, linked_value, elidable));
    Ok(())
}

fn write_labels(writer: &mut Writer<Vec<u8>>, labels: &[AxisLabel]) -> DesignspaceResult<()> {
    write_event(writer, Event::Start(BytesStart::new("labels")))?;
    for label in labels {
        let mut event = BytesStart::new("label");
        let value = label.value.to_string();
        event.push_attribute(("name", label.name.as_str()));
        event.push_attribute(("uservalue", value.as_str()));

        let range_values = label
            .range
            .as_ref()
            .map(|range| (range.minimum.to_string(), range.maximum.to_string()));
        if let Some((minimum, maximum)) = &range_values {
            event.push_attribute(("userminimum", minimum.as_str()));
            event.push_attribute(("usermaximum", maximum.as_str()));
        }

        let linked_value = label.linked_value.map(|value| value.to_string());
        if let Some(linked_value) = &linked_value {
            event.push_attribute(("linkeduservalue", linked_value.as_str()));
        }
        if label.elidable {
            event.push_attribute(("elidable", "true"));
        }

        write_event(writer, Event::Empty(event))?;
    }
    write_event(writer, Event::End(BytesEnd::new("labels")))
}

fn required_attribute(
    reader: &Reader<&[u8]>,
    event: &BytesStart,
    name: &[u8],
) -> DesignspaceResult<String> {
    attribute(reader, event, name)?.ok_or_else(|| DesignspaceError::ParseDesignspaceXml {
        details: format!(
            "{} element is missing {}",
            String::from_utf8_lossy(event.name().as_ref()),
            String::from_utf8_lossy(name)
        ),
    })
}

fn number_attribute(
    reader: &Reader<&[u8]>,
    event: &BytesStart,
    name: &[u8],
) -> DesignspaceResult<Option<f64>> {
    attribute(reader, event, name)?
        .map(|value| {
            value
                .parse::<f64>()
                .map_err(|error| DesignspaceError::ParseDesignspaceXml {
                    details: format!(
                        "invalid {} value {value:?}: {error}",
                        String::from_utf8_lossy(name)
                    ),
                })
        })
        .transpose()
}

fn attribute(
    reader: &Reader<&[u8]>,
    event: &BytesStart,
    name: &[u8],
) -> DesignspaceResult<Option<String>> {
    for attribute in event.attributes() {
        let attribute = attribute.map_err(parse_error)?;
        if attribute.key.as_ref() == name {
            return attribute
                .decode_and_unescape_value(reader.decoder())
                .map(|value| Some(value.into_owned()))
                .map_err(parse_error);
        }
    }

    Ok(None)
}

fn write_event(writer: &mut Writer<Vec<u8>>, event: Event) -> DesignspaceResult<()> {
    writer.write_event(event).map_err(parse_error)
}

fn parse_error(error: impl ToString) -> DesignspaceError {
    DesignspaceError::ParseDesignspaceXml {
        details: error.to_string(),
    }
}
