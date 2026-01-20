use crate::entity::AnchorId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Anchor {
    id: AnchorId,
    name: String,
    x: f64,
    y: f64,
}

impl Anchor {
    pub fn new(name: String, x: f64, y: f64) -> Self {
        Self {
            id: AnchorId::new(),
            name,
            x,
            y,
        }
    }

    pub fn id(&self) -> AnchorId {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn x(&self) -> f64 {
        self.x
    }

    pub fn y(&self) -> f64 {
        self.y
    }

    pub fn position(&self) -> (f64, f64) {
        (self.x, self.y)
    }

    pub fn set_position(&mut self, x: f64, y: f64) {
        self.x = x;
        self.y = y;
    }

    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }

    pub fn translate(&mut self, dx: f64, dy: f64) {
        self.x += dx;
        self.y += dy;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_creation() {
        let a = Anchor::new("top".to_string(), 250.0, 700.0);
        assert_eq!(a.name(), "top");
        assert_eq!(a.x(), 250.0);
        assert_eq!(a.y(), 700.0);
    }

    #[test]
    fn anchor_mutation() {
        let mut a = Anchor::new("top".to_string(), 250.0, 700.0);
        a.set_position(300.0, 750.0);
        assert_eq!(a.position(), (300.0, 750.0));

        a.translate(-50.0, 50.0);
        assert_eq!(a.position(), (250.0, 800.0));
    }
}
