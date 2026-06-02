use crate::entity::LayerId;
use crate::lib_data::LibData;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Layer {
    id: LayerId,
    name: String,
    color: Option<String>,
    lib: LibData,
}

impl Layer {
    pub fn new(name: String) -> Self {
        Self {
            id: LayerId::new(),
            name,
            color: None,
            lib: LibData::new(),
        }
    }

    pub fn default_layer() -> Self {
        Self::new("public.default".to_string())
    }

    pub fn with_id(id: LayerId, name: String) -> Self {
        Self {
            id,
            name,
            color: None,
            lib: LibData::new(),
        }
    }

    pub fn id(&self) -> LayerId {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn color(&self) -> Option<&str> {
        self.color.as_deref()
    }

    pub fn lib(&self) -> &LibData {
        &self.lib
    }

    pub fn lib_mut(&mut self) -> &mut LibData {
        &mut self.lib
    }

    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }

    pub fn set_color(&mut self, color: Option<String>) {
        self.color = color;
    }

    pub fn is_default(&self) -> bool {
        self.name == "public.default"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_creation() {
        let l = Layer::new("foreground".to_string());
        assert_eq!(l.name(), "foreground");
        assert_eq!(l.color(), None);
    }

    #[test]
    fn default_layer() {
        let l = Layer::default_layer();
        assert!(l.is_default());
        assert_eq!(l.name(), "public.default");
    }
}
