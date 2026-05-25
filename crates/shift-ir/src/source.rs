use crate::axis::Location;
use crate::entity::{LayerId, SourceId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    id: SourceId,
    name: String,
    location: Location,
    layer_id: LayerId,
    filename: Option<String>,
}

impl Source {
    pub fn new(name: String, location: Location, layer_id: LayerId) -> Self {
        Self {
            id: SourceId::for_name(&name),
            name,
            location,
            layer_id,
            filename: None,
        }
    }

    pub fn with_id(id: SourceId, name: String, location: Location, layer_id: LayerId) -> Self {
        Self {
            id,
            name,
            location,
            layer_id,
            filename: None,
        }
    }

    pub fn with_filename(
        name: String,
        location: Location,
        layer_id: LayerId,
        filename: String,
    ) -> Self {
        Self {
            id: SourceId::for_name(&name),
            name,
            location,
            layer_id,
            filename: Some(filename),
        }
    }

    pub fn id(&self) -> SourceId {
        self.id.clone()
    }

    pub fn id_ref(&self) -> &SourceId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn location(&self) -> &Location {
        &self.location
    }

    pub fn layer_id(&self) -> LayerId {
        self.layer_id
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_creation() {
        let layer_id = LayerId::new();
        let mut location = Location::new();
        location.set("wght".to_string(), 400.0);

        let source = Source::new("Regular".to_string(), location, layer_id);
        assert_eq!(source.name(), "Regular");
        assert_eq!(source.id_ref().as_str(), "source_Regular");
        assert_eq!(source.location().get("wght"), Some(400.0));
    }

    #[test]
    fn source_with_id_preserves_stable_identity_across_name_changes() {
        let layer_id = LayerId::new();
        let source_id = SourceId::from_stable("source_custom_primary").unwrap();
        let mut source = Source::with_id(
            source_id.clone(),
            "Regular".to_string(),
            Location::new(),
            layer_id,
        );

        source.set_name("Text Regular".to_string());

        assert_eq!(source.id_ref(), &source_id);
        assert_eq!(source.name(), "Text Regular");
    }
}
