use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct FeatureData {
    fea_source: Option<String>,
}

impl FeatureData {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_fea(source: String) -> Self {
        Self {
            fea_source: Some(source),
        }
    }

    pub fn fea_source(&self) -> Option<&str> {
        self.fea_source.as_deref()
    }

    pub fn set_fea_source(&mut self, source: Option<String>) {
        self.fea_source = source;
    }

    pub fn has_features(&self) -> bool {
        self.fea_source.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_data() {
        let features = FeatureData::from_fea("feature liga { sub f i by fi; } liga;".to_string());
        assert!(features.has_features());
        assert!(features.fea_source().unwrap().contains("liga"));
    }

    #[test]
    fn empty_features() {
        let features = FeatureData::new();
        assert!(!features.has_features());
        assert_eq!(features.fea_source(), None);
    }
}
