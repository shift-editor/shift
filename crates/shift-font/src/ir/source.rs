use crate::axis::Location;
use crate::entity::SourceId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    id: SourceId,
    name: String,
    location: Location,
    filename: Option<String>,
}

impl Source {
    pub fn new(name: String, location: Location) -> Self {
        Self {
            id: SourceId::new(),
            name,
            location,
            filename: None,
        }
    }

    pub fn with_filename(name: String, location: Location, filename: String) -> Self {
        Self {
            id: SourceId::new(),
            name,
            location,
            filename: Some(filename),
        }
    }

    pub fn with_id(
        id: SourceId,
        name: String,
        location: Location,
        filename: Option<String>,
    ) -> Self {
        Self {
            id,
            name,
            location,
            filename,
        }
    }

    pub fn id(&self) -> SourceId {
        self.id.clone()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn location(&self) -> &Location {
        &self.location
    }

    pub fn filename(&self) -> Option<&str> {
        self.filename.as_deref()
    }

    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }

    pub fn set_location(&mut self, location: Location) {
        self.location = location;
    }

    pub fn remove_axis_location(&mut self, axis_id: &crate::AxisId) -> Option<f64> {
        self.location.remove(axis_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AxisId;

    #[test]
    fn source_creation() {
        let mut location = Location::new();
        let axis_id = AxisId::from_raw("wght");
        location.set(axis_id.clone(), 400.0);

        let source = Source::new("Regular".to_string(), location);
        assert_eq!(source.name(), "Regular");
        assert_eq!(source.location().get(&axis_id), Some(400.0));
    }
}
