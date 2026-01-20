use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Axis {
    tag: String,
    name: String,
    minimum: f64,
    default: f64,
    maximum: f64,
    hidden: bool,
}

impl Axis {
    pub fn new(tag: String, name: String, minimum: f64, default: f64, maximum: f64) -> Self {
        Self {
            tag,
            name,
            minimum,
            default,
            maximum,
            hidden: false,
        }
    }

    pub fn weight() -> Self {
        Self::new(
            "wght".to_string(),
            "Weight".to_string(),
            100.0,
            400.0,
            900.0,
        )
    }

    pub fn width() -> Self {
        Self::new("wdth".to_string(), "Width".to_string(), 75.0, 100.0, 125.0)
    }

    pub fn tag(&self) -> &str {
        &self.tag
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn minimum(&self) -> f64 {
        self.minimum
    }

    pub fn default(&self) -> f64 {
        self.default
    }

    pub fn maximum(&self) -> f64 {
        self.maximum
    }

    pub fn is_hidden(&self) -> bool {
        self.hidden
    }

    pub fn set_hidden(&mut self, hidden: bool) {
        self.hidden = hidden;
    }

    pub fn normalize(&self, value: f64) -> f64 {
        if value < self.default {
            if (self.default - self.minimum).abs() < f64::EPSILON {
                0.0
            } else {
                (value - self.default) / (self.default - self.minimum)
            }
        } else if value > self.default {
            if (self.maximum - self.default).abs() < f64::EPSILON {
                0.0
            } else {
                (value - self.default) / (self.maximum - self.default)
            }
        } else {
            0.0
        }
    }

    pub fn denormalize(&self, value: f64) -> f64 {
        if value < 0.0 {
            self.default + value * (self.default - self.minimum)
        } else if value > 0.0 {
            self.default + value * (self.maximum - self.default)
        } else {
            self.default
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Location {
    values: HashMap<String, f64>,
}

impl Location {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(values: HashMap<String, f64>) -> Self {
        Self { values }
    }

    pub fn get(&self, axis_tag: &str) -> Option<f64> {
        self.values.get(axis_tag).copied()
    }

    pub fn set(&mut self, axis_tag: String, value: f64) {
        self.values.insert(axis_tag, value);
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &f64)> {
        self.values.iter()
    }

    pub fn normalize(&self, axes: &[Axis]) -> Location {
        let mut normalized = HashMap::new();
        for axis in axes {
            if let Some(&value) = self.values.get(axis.tag()) {
                normalized.insert(axis.tag().to_string(), axis.normalize(value));
            }
        }
        Location::from_map(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axis_normalize() {
        let axis = Axis::weight();

        assert_eq!(axis.normalize(400.0), 0.0);
        assert!((axis.normalize(100.0) - (-1.0)).abs() < 0.001);
        assert!((axis.normalize(900.0) - 1.0).abs() < 0.001);
        assert!((axis.normalize(250.0) - (-0.5)).abs() < 0.001);
    }

    #[test]
    fn axis_denormalize() {
        let axis = Axis::weight();

        assert_eq!(axis.denormalize(0.0), 400.0);
        assert_eq!(axis.denormalize(-1.0), 100.0);
        assert_eq!(axis.denormalize(1.0), 900.0);
    }

    #[test]
    fn location_operations() {
        let mut loc = Location::new();
        loc.set("wght".to_string(), 700.0);
        loc.set("wdth".to_string(), 100.0);

        assert_eq!(loc.get("wght"), Some(700.0));
        assert_eq!(loc.get("wdth"), Some(100.0));
        assert_eq!(loc.get("slnt"), None);
    }
}
