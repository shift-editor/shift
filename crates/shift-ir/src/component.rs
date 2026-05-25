use crate::entity::{ComponentId, GlyphId};
use crate::{GlyphName, Location};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Component {
    id: ComponentId,
    base_glyph_id: GlyphId,
    base_glyph: GlyphName,
    transform: DecomposedTransform,
    #[serde(default)]
    location: Location,
    #[serde(default)]
    axis_inheritance: AxisInheritance,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AxisInheritance {
    #[default]
    InheritParent,
    ResetUnspecifiedToDefault,
}

/// Raw 2D affine transformation matrix (6 values).
///
/// Represents a 3x3 homogeneous matrix with implicit bottom row [0, 0, 1]:
/// ```text
/// | xx  yx  dx |
/// | xy  yy  dy |
/// | 0   0   1  | (implicit)
/// ```
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Transform {
    pub xx: f64,
    pub xy: f64,
    pub yx: f64,
    pub yy: f64,
    pub dx: f64,
    pub dy: f64,
}

/// Decomposed 2D transformation with explicit scale, rotation, skew, and translation.
/// Composition order: translate to center → rotate → scale → skew → translate back
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecomposedTransform {
    pub translate_x: f64,
    pub translate_y: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub skew_x: f64,
    pub skew_y: f64,
    pub t_center_x: f64,
    pub t_center_y: f64,
}

impl Default for DecomposedTransform {
    fn default() -> Self {
        Self {
            translate_x: 0.0,
            translate_y: 0.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            skew_x: 0.0,
            skew_y: 0.0,
            t_center_x: 0.0,
            t_center_y: 0.0,
        }
    }
}

impl DecomposedTransform {
    pub fn identity() -> Self {
        Self::default()
    }

    pub fn is_identity(&self) -> bool {
        self.translate_x.abs() < f64::EPSILON
            && self.translate_y.abs() < f64::EPSILON
            && self.rotation.abs() < f64::EPSILON
            && (self.scale_x - 1.0).abs() < f64::EPSILON
            && (self.scale_y - 1.0).abs() < f64::EPSILON
            && self.skew_x.abs() < f64::EPSILON
            && self.skew_y.abs() < f64::EPSILON
    }

    /// Compose the decomposed transform into a raw affine matrix.
    ///
    /// Order: translate to center → scale → skew → rotate → translate back → translate
    pub fn to_matrix(&self) -> Transform {
        let cos_r = self.rotation.to_radians().cos();
        let sin_r = self.rotation.to_radians().sin();
        let tan_sx = self.skew_x.to_radians().tan();
        let tan_sy = self.skew_y.to_radians().tan();

        let xx = self.scale_x * cos_r + self.scale_y * tan_sx * sin_r;
        let xy = self.scale_x * sin_r - self.scale_y * tan_sx * cos_r;
        let yx = self.scale_y * -sin_r + self.scale_x * tan_sy * cos_r;
        let yy = self.scale_y * cos_r + self.scale_x * tan_sy * sin_r;

        let center_x = self.t_center_x;
        let center_y = self.t_center_y;
        let dx = self.translate_x + center_x - (xx * center_x + yx * center_y);
        let dy = self.translate_y + center_y - (xy * center_x + yy * center_y);

        Transform {
            xx,
            xy,
            yx,
            yy,
            dx,
            dy,
        }
    }

    /// Decompose a raw affine matrix into components.
    ///
    /// Note: This assumes no transformation center (t_center = 0, 0).
    /// For matrices with skew, decomposition may not perfectly roundtrip.
    pub fn from_matrix(m: &Transform) -> Self {
        let scale_x = (m.xx * m.xx + m.xy * m.xy).sqrt();
        let scale_y = (m.yx * m.yx + m.yy * m.yy).sqrt();

        let det = m.xx * m.yy - m.xy * m.yx;
        let scale_y = if det < 0.0 { -scale_y } else { scale_y };

        let rotation = m.xy.atan2(m.xx).to_degrees();

        let skew_x = if scale_y.abs() > f64::EPSILON {
            ((m.xx * m.yx + m.xy * m.yy) / (scale_x * scale_y))
                .atan()
                .to_degrees()
        } else {
            0.0
        };

        Self {
            translate_x: m.dx,
            translate_y: m.dy,
            rotation,
            scale_x,
            scale_y,
            skew_x,
            skew_y: 0.0,
            t_center_x: 0.0,
            t_center_y: 0.0,
        }
    }

    pub fn transform_point(&self, x: f64, y: f64) -> (f64, f64) {
        self.to_matrix().transform_point(x, y)
    }
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

    /// Compose transforms as `self ∘ other` (apply `other`, then `self`).
    pub fn compose(self, other: Self) -> Self {
        Self {
            xx: self.xx * other.xx + self.yx * other.xy,
            xy: self.xy * other.xx + self.yy * other.xy,
            yx: self.xx * other.yx + self.yx * other.yy,
            yy: self.xy * other.yx + self.yy * other.yy,
            dx: self.xx * other.dx + self.yx * other.dy + self.dx,
            dy: self.xy * other.dx + self.yy * other.dy + self.dy,
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
    pub fn new(base_glyph: impl Into<GlyphName>) -> Self {
        let base_glyph = base_glyph.into();
        Self {
            id: ComponentId::new(),
            base_glyph_id: GlyphId::for_name(base_glyph.as_str()),
            base_glyph,
            transform: DecomposedTransform::identity(),
            location: Location::new(),
            axis_inheritance: AxisInheritance::InheritParent,
        }
    }

    pub fn with_transform(
        base_glyph: impl Into<GlyphName>,
        transform: DecomposedTransform,
    ) -> Self {
        let base_glyph = base_glyph.into();
        Self {
            id: ComponentId::new(),
            base_glyph_id: GlyphId::for_name(base_glyph.as_str()),
            base_glyph,
            transform,
            location: Location::new(),
            axis_inheritance: AxisInheritance::InheritParent,
        }
    }

    pub fn with_id(
        id: ComponentId,
        base_glyph: impl Into<GlyphName>,
        transform: DecomposedTransform,
    ) -> Self {
        let base_glyph = base_glyph.into();
        Self {
            id,
            base_glyph_id: GlyphId::for_name(base_glyph.as_str()),
            base_glyph,
            transform,
            location: Location::new(),
            axis_inheritance: AxisInheritance::InheritParent,
        }
    }

    pub fn with_base_glyph_id(
        id: ComponentId,
        base_glyph_id: GlyphId,
        base_glyph: impl Into<GlyphName>,
        transform: DecomposedTransform,
    ) -> Self {
        Self {
            id,
            base_glyph_id,
            base_glyph: base_glyph.into(),
            transform,
            location: Location::new(),
            axis_inheritance: AxisInheritance::InheritParent,
        }
    }

    pub fn with_matrix(base_glyph: impl Into<GlyphName>, matrix: &Transform) -> Self {
        let base_glyph = base_glyph.into();
        Self {
            id: ComponentId::new(),
            base_glyph_id: GlyphId::for_name(base_glyph.as_str()),
            base_glyph,
            transform: DecomposedTransform::from_matrix(matrix),
            location: Location::new(),
            axis_inheritance: AxisInheritance::InheritParent,
        }
    }

    pub fn id(&self) -> ComponentId {
        self.id.clone()
    }

    pub fn id_ref(&self) -> &ComponentId {
        &self.id
    }

    pub fn base_glyph(&self) -> &GlyphName {
        &self.base_glyph
    }

    pub fn base_glyph_id(&self) -> GlyphId {
        self.base_glyph_id.clone()
    }

    pub fn base_glyph_id_ref(&self) -> &GlyphId {
        &self.base_glyph_id
    }

    pub fn transform(&self) -> &DecomposedTransform {
        &self.transform
    }

    pub fn location(&self) -> &Location {
        &self.location
    }

    pub fn axis_inheritance(&self) -> AxisInheritance {
        self.axis_inheritance
    }

    pub fn matrix(&self) -> Transform {
        self.transform.to_matrix()
    }

    pub fn set_transform(&mut self, transform: DecomposedTransform) {
        self.transform = transform;
    }

    pub fn set_location(&mut self, location: Location) {
        self.location = location;
    }

    pub fn set_location_axis(&mut self, axis_tag: impl Into<String>, value: f64) {
        self.location.set(axis_tag.into(), value);
    }

    pub fn set_axis_inheritance(&mut self, axis_inheritance: AxisInheritance) {
        self.axis_inheritance = axis_inheritance;
    }

    pub fn translate(&mut self, dx: f64, dy: f64) {
        self.transform.translate_x += dx;
        self.transform.translate_y += dy;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_creation() {
        let c = Component::new("a".to_string());
        assert_eq!(c.base_glyph_id_ref().as_str(), "glyph_a");
        assert_eq!(c.base_glyph().as_str(), "a");
        assert!(c.transform().is_identity());
        assert!(c.location().is_empty());
        assert_eq!(c.axis_inheritance(), AxisInheritance::InheritParent);
    }

    #[test]
    fn component_location_and_axis_inheritance_are_editable() {
        let mut c = Component::new("stem".to_string());

        c.set_location_axis("wght", 700.0);
        c.set_axis_inheritance(AxisInheritance::ResetUnspecifiedToDefault);

        assert_eq!(c.location().get("wght"), Some(700.0));
        assert_eq!(
            c.axis_inheritance(),
            AxisInheritance::ResetUnspecifiedToDefault
        );
    }

    #[test]
    fn component_preserves_stable_base_glyph_identity_separately_from_label() {
        let component_id = ComponentId::from_stable("component_Aacute_base").unwrap();
        let base_glyph_id = GlyphId::from_stable("glyph_base_A").unwrap();
        let component = Component::with_base_glyph_id(
            component_id.clone(),
            base_glyph_id.clone(),
            "A",
            DecomposedTransform::identity(),
        );

        assert_eq!(component.id_ref(), &component_id);
        assert_eq!(component.base_glyph_id_ref(), &base_glyph_id);
        assert_eq!(component.base_glyph().as_str(), "A");
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

    #[test]
    fn transform_compose_order() {
        let translate = Transform::translate(10.0, 20.0);
        let scale = Transform::scale(2.0, 3.0);
        let composed = translate.compose(scale);
        let (x, y) = composed.transform_point(4.0, 5.0);

        assert_eq!(x, 18.0);
        assert_eq!(y, 35.0);
    }

    #[test]
    fn decomposed_transform_identity() {
        let d = DecomposedTransform::identity();
        assert!(d.is_identity());
        let m = d.to_matrix();
        assert!(m.is_identity());
    }

    #[test]
    fn decomposed_transform_translate() {
        let d = DecomposedTransform {
            translate_x: 100.0,
            translate_y: 50.0,
            ..Default::default()
        };
        let (x, y) = d.transform_point(10.0, 20.0);
        assert!((x - 110.0).abs() < 1e-10);
        assert!((y - 70.0).abs() < 1e-10);
    }

    #[test]
    fn decomposed_transform_scale() {
        let d = DecomposedTransform {
            scale_x: 2.0,
            scale_y: 3.0,
            ..Default::default()
        };
        let (x, y) = d.transform_point(10.0, 20.0);
        assert!((x - 20.0).abs() < 1e-10);
        assert!((y - 60.0).abs() < 1e-10);
    }

    #[test]
    fn decomposed_transform_roundtrip() {
        let original = DecomposedTransform {
            translate_x: 50.0,
            translate_y: 100.0,
            rotation: 45.0,
            scale_x: 2.0,
            scale_y: 1.5,
            ..Default::default()
        };
        let matrix = original.to_matrix();
        let roundtrip = DecomposedTransform::from_matrix(&matrix);

        assert!((original.translate_x - roundtrip.translate_x).abs() < 1e-10);
        assert!((original.translate_y - roundtrip.translate_y).abs() < 1e-10);
        assert!((original.rotation - roundtrip.rotation).abs() < 1e-10);
        assert!((original.scale_x - roundtrip.scale_x).abs() < 1e-10);
        assert!((original.scale_y - roundtrip.scale_y).abs() < 1e-10);
    }

    #[test]
    fn component_translate() {
        let mut c = Component::new("a".to_string());
        c.translate(10.0, 20.0);
        assert!((c.transform().translate_x - 10.0).abs() < 1e-10);
        assert!((c.transform().translate_y - 20.0).abs() < 1e-10);
    }
}
