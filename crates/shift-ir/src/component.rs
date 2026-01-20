use crate::entity::ComponentId;
use crate::GlyphName;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Component {
    id: ComponentId,
    base_glyph: GlyphName,
    transform: Transform,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Transform {
    pub xx: f64,
    pub xy: f64,
    pub yx: f64,
    pub yy: f64,
    pub dx: f64,
    pub dy: f64,
}

impl Transform {
    pub fn identity() -> Self {
        Self {
            xx: 1.0,
            xy: 0.0,
            yx: 0.0,
            yy: 1.0,
            dx: 0.0,
            dy: 0.0,
        }
    }

    pub fn translate(dx: f64, dy: f64) -> Self {
        Self {
            dx,
            dy,
            ..Self::identity()
        }
    }

    pub fn scale(sx: f64, sy: f64) -> Self {
        Self {
            xx: sx,
            yy: sy,
            ..Self::identity()
        }
    }

    pub fn is_identity(&self) -> bool {
        (self.xx - 1.0).abs() < f64::EPSILON
            && self.xy.abs() < f64::EPSILON
            && self.yx.abs() < f64::EPSILON
            && (self.yy - 1.0).abs() < f64::EPSILON
            && self.dx.abs() < f64::EPSILON
            && self.dy.abs() < f64::EPSILON
    }

    pub fn transform_point(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.xx * x + self.yx * y + self.dx,
            self.xy * x + self.yy * y + self.dy,
        )
    }
}

impl Component {
    pub fn new(base_glyph: GlyphName) -> Self {
        Self {
            id: ComponentId::new(),
            base_glyph,
            transform: Transform::identity(),
        }
    }

    pub fn with_transform(base_glyph: GlyphName, transform: Transform) -> Self {
        Self {
            id: ComponentId::new(),
            base_glyph,
            transform,
        }
    }

    pub fn id(&self) -> ComponentId {
        self.id
    }

    pub fn base_glyph(&self) -> &GlyphName {
        &self.base_glyph
    }

    pub fn transform(&self) -> &Transform {
        &self.transform
    }

    pub fn set_transform(&mut self, transform: Transform) {
        self.transform = transform;
    }

    pub fn translate(&mut self, dx: f64, dy: f64) {
        self.transform.dx += dx;
        self.transform.dy += dy;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_creation() {
        let c = Component::new("a".to_string());
        assert_eq!(c.base_glyph(), "a");
        assert!(c.transform().is_identity());
    }

    #[test]
    fn transform_point() {
        let t = Transform::translate(100.0, 50.0);
        let (x, y) = t.transform_point(10.0, 20.0);
        assert_eq!(x, 110.0);
        assert_eq!(y, 70.0);
    }

    #[test]
    fn transform_scale() {
        let t = Transform::scale(2.0, 3.0);
        let (x, y) = t.transform_point(10.0, 20.0);
        assert_eq!(x, 20.0);
        assert_eq!(y, 60.0);
    }
}
