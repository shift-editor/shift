//! CLI product snapshots expose stable identity and ordered, user-tagged coordinates.

use std::collections::BTreeMap;

use serde::Serialize;
use shift_font::{Font, NamedInstance};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceReport {
    pub instance_id: String,
    pub name: String,
    pub location: BTreeMap<String, f64>,
    pub postscript_name: Option<String>,
}

impl InstanceReport {
    pub(crate) fn from_instance(font: &Font, instance: &NamedInstance) -> Self {
        Self {
            instance_id: instance.id().to_string(),
            name: instance.name().to_string(),
            location: instance
                .location()
                .iter()
                .filter_map(|(axis_id, value)| {
                    let axis = font.axis(axis_id)?;
                    Some((axis.tag().to_string(), *value))
                })
                .collect(),
            postscript_name: instance.postscript_name().map(str::to_string),
        }
    }

    pub(crate) fn render(&self) -> String {
        let location = self
            .location
            .iter()
            .map(|(tag, value)| format!("{tag}={value}"))
            .collect::<Vec<_>>()
            .join(", ");
        format!("  {}  {}  {location}", self.name, self.instance_id)
    }
}
