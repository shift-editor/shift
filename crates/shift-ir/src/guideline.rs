use crate::entity::GuidelineId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GuidelineOrientation {
    Horizontal,
    Vertical,
    Angle,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Guideline {
    id: GuidelineId,
    x: Option<f64>,
    y: Option<f64>,
    angle: Option<f64>,
    name: Option<String>,
    color: Option<String>,
}

impl Guideline {
    pub fn horizontal(y: f64) -> Self {
        Self {
            id: GuidelineId::new(),
            x: None,
            y: Some(y),
            angle: None,
            name: None,
            color: None,
        }
    }

    pub fn vertical(x: f64) -> Self {
        Self {
            id: GuidelineId::new(),
            x: Some(x),
            y: None,
            angle: None,
            name: None,
            color: None,
        }
    }

    pub fn angled(x: f64, y: f64, angle: f64) -> Self {
        Self {
            id: GuidelineId::new(),
            x: Some(x),
            y: Some(y),
            angle: Some(angle),
            name: None,
            color: None,
        }
    }

    pub fn id(&self) -> GuidelineId {
        self.id
    }

    pub fn x(&self) -> Option<f64> {
        self.x
    }

    pub fn y(&self) -> Option<f64> {
        self.y
    }

    pub fn angle(&self) -> Option<f64> {
        self.angle
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn color(&self) -> Option<&str> {
        self.color.as_deref()
    }

    pub fn orientation(&self) -> GuidelineOrientation {
        match (self.x, self.y, self.angle) {
            (None, Some(_), None) => GuidelineOrientation::Horizontal,
            (Some(_), None, None) => GuidelineOrientation::Vertical,
            _ => GuidelineOrientation::Angle,
        }
    }

    pub fn set_name(&mut self, name: Option<String>) {
        self.name = name;
    }

    pub fn set_color(&mut self, color: Option<String>) {
        self.color = color;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horizontal_guideline() {
        let g = Guideline::horizontal(700.0);
        assert_eq!(g.orientation(), GuidelineOrientation::Horizontal);
        assert_eq!(g.y(), Some(700.0));
        assert_eq!(g.x(), None);
    }

    #[test]
    fn vertical_guideline() {
        let g = Guideline::vertical(250.0);
        assert_eq!(g.orientation(), GuidelineOrientation::Vertical);
        assert_eq!(g.x(), Some(250.0));
        assert_eq!(g.y(), None);
    }

    #[test]
    fn angled_guideline() {
        let g = Guideline::angled(100.0, 100.0, 45.0);
        assert_eq!(g.orientation(), GuidelineOrientation::Angle);
        assert_eq!(g.angle(), Some(45.0));
    }
}
