use crate::GlyphName;
use crate::collection::Identified;
use crate::entity::{ComponentId, GlyphId};
use crate::point::Canonical;
use serde::{Deserialize, Serialize};

/// Whether a component is placed by its anchors or by hand.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentAlignment {
    /// Not recorded, as in sources and documents from before alignment was:
    /// the component counts as anchored while it sits exactly on its anchors.
    #[default]
    Unset,
    /// Placed by its anchors: it follows them when they move.
    Anchored,
    /// Placed by hand: it stays where it was put.
    Free,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Component {
    id: ComponentId,
    base_glyph_id: GlyphId,
    base_glyph_name: GlyphName,
    transform: DecomposedTransform,
    #[serde(default)]
    alignment: ComponentAlignment,
}

impl Identified for Component {
    type Id = ComponentId;

    fn id(&self) -> Self::Id {
        Self::id(self)
    }
}

/// Raw 2D affine transformation matrix (6 values).
///
/// Represents a 3x3 homogeneous matrix with implicit bottom row [0, 0, 1]:
/// ```text
/// | xx  yx  dx |
/// | xy  yy  dy |
/// | 0   0   1  | (implicit)
/// ```
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
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
    /// Returns whether the placement only moves the component, as anchor
    /// alignment places it.
    pub fn is_translation(&self) -> bool {
        self.rotation == 0.0
            && self.scale_x == 1.0
            && self.scale_y == 1.0
            && self.skew_x == 0.0
            && self.skew_y == 0.0
    }

    /// Number of values in one transform's numeric encoding.
    pub const VALUE_COUNT: usize = 9;

    /// Serialized field names in numeric encoding order.
    ///
    /// Glyph interpolation values and component-transform intents store each
    /// transform as these fields, in this order. TypeScript layout modules are
    /// generated from this table.
    pub const VALUE_FIELDS: [&'static str; Self::VALUE_COUNT] = [
        "translateX",
        "translateY",
        "rotation",
        "scaleX",
        "scaleY",
        "skewX",
        "skewY",
        "tCenterX",
        "tCenterY",
    ];

    /// Encodes the transform in [`Self::VALUE_FIELDS`] order.
    pub fn to_values(self) -> [f64; Self::VALUE_COUNT] {
        [
            self.translate_x,
            self.translate_y,
            self.rotation,
            self.scale_x,
            self.scale_y,
            self.skew_x,
            self.skew_y,
            self.t_center_x,
            self.t_center_y,
        ]
    }

    /// Decodes values produced by [`Self::to_values`].
    pub fn from_values(values: [f64; Self::VALUE_COUNT]) -> Self {
        let [
            translate_x,
            translate_y,
            rotation,
            scale_x,
            scale_y,
            skew_x,
            skew_y,
            t_center_x,
            t_center_y,
        ] = values;
        Self {
            translate_x,
            translate_y,
            rotation,
            scale_x,
            scale_y,
            skew_x,
            skew_y,
            t_center_x,
            t_center_y,
        }
    }

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
    pub fn to_matrix(self) -> Transform {
        let cos_r = libm::cos(self.rotation.to_radians());
        let sin_r = libm::sin(self.rotation.to_radians());
        let tan_sx = libm::tan(self.skew_x.to_radians());
        let tan_sy = libm::tan(self.skew_y.to_radians());

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

        let rotation = libm::atan2(m.xy, m.xx).to_degrees();

        // A collapsed axis has no direction to measure skew against; 0/0 would be NaN.
        let skew_x = if scale_x.abs() > f64::EPSILON && scale_y.abs() > f64::EPSILON {
            libm::atan((m.xx * m.yx + m.xy * m.yy) / (scale_x * scale_y)).to_degrees()
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

    pub fn transform_point(self, point: kurbo::Point) -> kurbo::Point {
        self.to_matrix().transform_point(point)
    }

    /// A placement that only moves by `offset`.
    pub fn translation(offset: kurbo::Vec2) -> Self {
        Self {
            translate_x: offset.x,
            translate_y: offset.y,
            ..Default::default()
        }
    }

    /// The translation part of the placement.
    pub fn offset(&self) -> kurbo::Vec2 {
        kurbo::Vec2::new(self.translate_x, self.translate_y)
    }

    pub fn set_offset(&mut self, offset: kurbo::Vec2) {
        self.translate_x = offset.x.canonical();
        self.translate_y = offset.y.canonical();
    }
}

impl Canonical for DecomposedTransform {
    fn canonical(self) -> Self {
        Self::from_values(self.to_values().map(Canonical::canonical))
    }
}

impl Transform {
    /// Returns whether this transform mirrors, so a decomposed placement
    /// reverses closed contours.
    pub fn mirrors(&self) -> bool {
        self.xx * self.yy - self.xy * self.yx < 0.0
    }

    /// Number of values in one matrix's numeric encoding.
    pub const VALUE_COUNT: usize = 6;

    /// Serialized field names in numeric encoding order.
    ///
    /// Source glyph shapes that carry component matrices store each matrix as
    /// these fields, in this order. TypeScript layout modules are generated from
    /// this table.
    pub const VALUE_FIELDS: [&'static str; Self::VALUE_COUNT] =
        ["xx", "xy", "yx", "yy", "dx", "dy"];

    /// Encodes the matrix in [`Self::VALUE_FIELDS`] order.
    pub fn to_values(self) -> [f64; Self::VALUE_COUNT] {
        [self.xx, self.xy, self.yx, self.yy, self.dx, self.dy]
    }

    /// Decodes a matrix from [`Self::VALUE_FIELDS`] order.
    pub fn from_values([xx, xy, yx, yy, dx, dy]: [f64; Self::VALUE_COUNT]) -> Self {
        Self {
            xx,
            xy,
            yx,
            yy,
            dx,
            dy,
        }
    }

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

    pub fn transform_point(self, point: kurbo::Point) -> kurbo::Point {
        kurbo::Affine::from(self) * point
    }
}

impl From<Transform> for kurbo::Affine {
    fn from(transform: Transform) -> Self {
        Self::new(transform.to_values())
    }
}

impl Component {
    pub fn new(base_glyph_id: GlyphId, base_glyph_name: impl Into<GlyphName>) -> Self {
        Self {
            id: ComponentId::new(),
            base_glyph_id,
            base_glyph_name: base_glyph_name.into(),
            transform: DecomposedTransform::identity(),
            alignment: ComponentAlignment::Unset,
        }
    }

    pub fn with_transform(
        base_glyph_id: GlyphId,
        base_glyph_name: impl Into<GlyphName>,
        transform: DecomposedTransform,
    ) -> Self {
        Self {
            id: ComponentId::new(),
            base_glyph_id,
            base_glyph_name: base_glyph_name.into(),
            transform: transform.canonical(),
            alignment: ComponentAlignment::Unset,
        }
    }

    pub fn with_id(
        id: ComponentId,
        base_glyph_id: GlyphId,
        base_glyph_name: impl Into<GlyphName>,
        transform: DecomposedTransform,
    ) -> Self {
        Self {
            id,
            base_glyph_id,
            base_glyph_name: base_glyph_name.into(),
            transform: transform.canonical(),
            alignment: ComponentAlignment::Unset,
        }
    }

    pub fn with_matrix(
        base_glyph_id: GlyphId,
        base_glyph_name: impl Into<GlyphName>,
        matrix: &Transform,
    ) -> Self {
        Self {
            id: ComponentId::new(),
            base_glyph_id,
            base_glyph_name: base_glyph_name.into(),
            transform: DecomposedTransform::from_matrix(matrix).canonical(),
            alignment: ComponentAlignment::Unset,
        }
    }

    pub fn id(&self) -> ComponentId {
        self.id.clone()
    }

    pub fn base_glyph_id(&self) -> GlyphId {
        self.base_glyph_id
    }

    pub fn base_glyph_name(&self) -> &GlyphName {
        &self.base_glyph_name
    }

    pub fn transform(&self) -> &DecomposedTransform {
        &self.transform
    }

    pub fn matrix(&self) -> Transform {
        self.transform.to_matrix()
    }

    pub fn set_transform(&mut self, transform: DecomposedTransform) {
        self.transform = transform.canonical();
    }

    pub fn alignment(&self) -> ComponentAlignment {
        self.alignment
    }

    pub fn set_alignment(&mut self, alignment: ComponentAlignment) {
        self.alignment = alignment;
    }

    pub fn translate(&mut self, dx: f64, dy: f64) {
        let mut transform = self.transform;
        transform.translate_x += dx;
        transform.translate_y += dy;
        self.set_transform(transform);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_values_follow_serialized_fields<T: Serialize>(
        value: &T,
        fields: &[&str],
        values: &[f64],
    ) {
        let serialized = serde_json::to_value(value).unwrap();
        let object = serialized.as_object().unwrap();
        assert_eq!(object.len(), fields.len());
        for (field, value) in fields.iter().zip(values) {
            assert_eq!(object[*field].as_f64(), Some(*value), "{field}");
        }
    }

    #[test]
    fn decomposed_transform_values_follow_serialized_fields() {
        let transform =
            DecomposedTransform::from_values([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);

        assert_values_follow_serialized_fields(
            &transform,
            &DecomposedTransform::VALUE_FIELDS,
            &transform.to_values(),
        );
        assert_eq!(
            transform.to_values(),
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
        );
    }

    #[test]
    fn matrix_values_follow_serialized_fields() {
        let matrix = Transform {
            xx: 1.0,
            xy: 2.0,
            yx: 3.0,
            yy: 4.0,
            dx: 5.0,
            dy: 6.0,
        };

        assert_values_follow_serialized_fields(
            &matrix,
            &Transform::VALUE_FIELDS,
            &matrix.to_values(),
        );
    }

    #[test]
    fn component_creation() {
        let base_id = GlyphId::from_raw("a");
        let c = Component::new(base_id, "a".to_string());
        assert_eq!(c.base_glyph_id(), base_id);
        assert_eq!(c.base_glyph_name().as_str(), "a");
        assert!(c.transform().is_identity());
    }

    #[test]
    fn transform_point() {
        let t = Transform::translate(100.0, 50.0);
        let kurbo::Point { x, y } = t.transform_point(kurbo::Point::new(10.0, 20.0));
        assert_eq!(x, 110.0);
        assert_eq!(y, 70.0);
    }

    #[test]
    fn transform_scale() {
        let t = Transform::scale(2.0, 3.0);
        let kurbo::Point { x, y } = t.transform_point(kurbo::Point::new(10.0, 20.0));
        assert_eq!(x, 20.0);
        assert_eq!(y, 60.0);
    }

    #[test]
    fn transform_compose_order() {
        let translate = Transform::translate(10.0, 20.0);
        let scale = Transform::scale(2.0, 3.0);
        let composed = translate.compose(scale);
        let kurbo::Point { x, y } = composed.transform_point(kurbo::Point::new(4.0, 5.0));

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
        let kurbo::Point { x, y } = d.transform_point(kurbo::Point::new(10.0, 20.0));
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
        let kurbo::Point { x, y } = d.transform_point(kurbo::Point::new(10.0, 20.0));
        assert!((x - 20.0).abs() < 1e-10);
        assert!((y - 60.0).abs() < 1e-10);
    }

    #[test]
    fn decomposed_rotation_turns_counterclockwise() {
        let d = DecomposedTransform {
            rotation: 90.0,
            ..Default::default()
        };
        let kurbo::Point { x, y } = d.transform_point(kurbo::Point::new(1.0, 0.0));
        assert!(x.abs() < 1e-10);
        assert!((y - 1.0).abs() < 1e-10);
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
    fn decomposing_a_collapsed_x_axis_keeps_skew_finite() {
        let collapsed = Transform::scale(0.0, 2.0);

        let decomposed = DecomposedTransform::from_matrix(&collapsed);

        assert_eq!(decomposed.skew_x, 0.0);
        assert_eq!(decomposed.to_matrix(), collapsed);
    }

    #[test]
    fn component_translate() {
        let mut c = Component::new(GlyphId::from_raw("a"), "a".to_string());
        c.translate(10.0, 20.0);
        assert!((c.transform().translate_x - 10.0).abs() < 1e-10);
        assert!((c.transform().translate_y - 20.0).abs() < 1e-10);
    }

    #[test]
    fn only_a_negative_determinant_mirrors() {
        assert!(!Transform::identity().mirrors());
        assert!(Transform::scale(-1.0, 1.0).mirrors());
        assert!(!Transform::scale(-1.0, -1.0).mirrors());
    }
}
