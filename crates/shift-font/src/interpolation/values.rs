use crate::{CoreError, CoreResult, DecomposedTransform, GlyphLayer};

/// Index of the horizontal advance within a glyph's values.
pub const GLYPH_ADVANCE_VALUE_OFFSET: usize = 0;

/// Number of leading glyph values holding the horizontal advance.
pub const GLYPH_ADVANCE_VALUE_COUNT: usize = 1;

/// Coordinate names of one point or anchor position, in value order.
///
/// TypeScript reads positions at these offsets; the layout module is generated
/// from this table.
pub const GLYPH_POSITION_VALUE_FIELDS: [&str; 2] = ["x", "y"];

/// Number of glyph values per contour point: x, then y.
pub const GLYPH_POINT_VALUE_COUNT: usize = GLYPH_POSITION_VALUE_FIELDS.len();

/// Number of glyph values per anchor: x, then y.
pub const GLYPH_ANCHOR_VALUE_COUNT: usize = GLYPH_POSITION_VALUE_FIELDS.len();

/// Numeric glyph-layer values that participate in interpolation.
///
/// Values are ordered as advance width, contour point positions, anchor
/// positions, and component transforms. The ordering is owned alongside
/// [`GlyphLayer`] so persistence and transport adapters do not define domain
/// interpolation semantics.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphInterpolationValues {
    values: Vec<f64>,
}

impl GlyphInterpolationValues {
    /// Wraps values already encoded in the canonical glyph interpolation order.
    pub fn new(values: Vec<f64>) -> Self {
        Self { values }
    }

    /// Returns the canonical interpolation values for an authored layer.
    pub fn from_layer(layer: &GlyphLayer) -> Self {
        let mut values = Vec::new();
        values.push(layer.width());

        for contour in layer.contours_iter() {
            for point in contour.points() {
                values.push(point.x());
                values.push(point.y());
            }
        }

        for anchor in layer.anchors_iter() {
            values.push(anchor.x());
            values.push(anchor.y());
        }

        for component in layer.components_iter() {
            values.extend(component.transform().to_values());
        }

        Self { values }
    }

    pub fn as_slice(&self) -> &[f64] {
        &self.values
    }

    pub fn into_vec(self) -> Vec<f64> {
        self.values
    }
}

impl GlyphLayer {
    /// Returns the numeric values that participate in glyph interpolation.
    pub fn interpolation_values(&self) -> GlyphInterpolationValues {
        GlyphInterpolationValues::from_layer(self)
    }

    /// Replaces every contour point position, contour after contour, then
    /// every anchor position, each as `x, y`, keeping the advance and the
    /// component transforms.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::MissingGlyphValue`] or
    /// [`CoreError::TrailingGlyphValues`] when `positions` does not hold one
    /// pair per point and anchor, and the errors of
    /// [`Self::apply_interpolation_values`] for a value that is not finite.
    pub fn set_positions(&mut self, positions: &[f64]) -> CoreResult<()> {
        let count = self
            .contours_iter()
            .map(|contour| contour.points().len() * GLYPH_POINT_VALUE_COUNT)
            .sum::<usize>()
            + self.anchors().len() * GLYPH_ANCHOR_VALUE_COUNT;
        if positions.len() < count {
            return Err(CoreError::MissingGlyphValue {
                index: GLYPH_ADVANCE_VALUE_COUNT + positions.len(),
            });
        }
        if positions.len() > count {
            return Err(CoreError::TrailingGlyphValues {
                expected: count,
                actual: positions.len(),
            });
        }
        let mut values = self.interpolation_values().into_vec();
        if let Some(target) =
            values.get_mut(GLYPH_ADVANCE_VALUE_COUNT..GLYPH_ADVANCE_VALUE_COUNT + count)
        {
            target.copy_from_slice(positions);
        }
        self.apply_interpolation_values(&GlyphInterpolationValues::new(values))
    }

    /// Replaces every interpolating value without changing layer topology.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::MissingGlyphValue`] or
    /// [`CoreError::TrailingGlyphValues`] when `values` does not match this
    /// layer's contour, anchor, and component structure. Shape mismatches are
    /// rejected before any layer value changes.
    pub fn apply_interpolation_values(
        &mut self,
        values: &GlyphInterpolationValues,
    ) -> CoreResult<()> {
        let expected = GLYPH_ADVANCE_VALUE_COUNT
            + self
                .contours_iter()
                .map(|contour| contour.points().len() * GLYPH_POINT_VALUE_COUNT)
                .sum::<usize>()
            + self.anchors().len() * GLYPH_ANCHOR_VALUE_COUNT
            + self.components().len() * DecomposedTransform::VALUE_COUNT;
        let actual = values.as_slice().len();
        if actual < expected {
            return Err(CoreError::MissingGlyphValue { index: actual });
        }
        if actual > expected {
            return Err(CoreError::TrailingGlyphValues { expected, actual });
        }
        if values.as_slice().iter().any(|value| !value.is_finite()) {
            return Err(CoreError::InvalidPositionUpdateInput {
                kind: "glyph interpolation values",
                message: "values must be finite".to_string(),
            });
        }

        let mut cursor = ValueCursor::new(values.as_slice());
        self.set_width(cursor.next()?);

        for contour in self.contours_iter_mut() {
            for point in contour.points_mut() {
                point.set_position(cursor.next()?, cursor.next()?);
            }
        }

        for anchor in self.anchors_iter_mut() {
            anchor.set_position(cursor.next()?, cursor.next()?);
        }

        for component in self.components_iter_mut() {
            let mut transform = [0.0; DecomposedTransform::VALUE_COUNT];
            for value in &mut transform {
                *value = cursor.next()?;
            }
            component.set_transform(DecomposedTransform::from_values(transform));
        }

        cursor.finish()
    }
}

struct ValueCursor<'a> {
    values: &'a [f64],
    index: usize,
}

impl<'a> ValueCursor<'a> {
    fn new(values: &'a [f64]) -> Self {
        Self { values, index: 0 }
    }

    fn next(&mut self) -> CoreResult<f64> {
        let index = self.index;
        let value = self
            .values
            .get(index)
            .copied()
            .ok_or(CoreError::MissingGlyphValue { index })?;
        self.index += 1;
        Ok(value)
    }

    fn finish(self) -> CoreResult<()> {
        if self.index == self.values.len() {
            return Ok(());
        }

        Err(CoreError::TrailingGlyphValues {
            expected: self.index,
            actual: self.values.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GLYPH_ADVANCE_VALUE_COUNT, GLYPH_ADVANCE_VALUE_OFFSET, GLYPH_ANCHOR_VALUE_COUNT,
        GLYPH_POINT_VALUE_COUNT, GLYPH_POSITION_VALUE_FIELDS,
    };
    use crate::test_support::generated::{TypeScriptModule, assert_generated_file};
    use crate::{
        Anchor, Contour, DecomposedTransform, GlyphLayer, LayerId, PointType, SourceId, Transform,
    };

    fn field_indices<'a>(fields: &[&'a str]) -> Vec<(&'a str, usize)> {
        fields.iter().copied().zip(0..).collect()
    }

    fn position_offset(field: &str) -> usize {
        GLYPH_POSITION_VALUE_FIELDS
            .iter()
            .position(|candidate| *candidate == field)
            .unwrap()
    }

    #[test]
    fn layer_values_place_advance_and_positions_at_their_offsets() {
        let mut layer = GlyphLayer::with_width(LayerId::new(), SourceId::new(), 600.0);
        let mut contour = Contour::new();
        contour.add_point(11.0, 13.0, PointType::OnCurve, false);
        layer.add_contour(contour);
        layer.add_anchor(Anchor::new("top".to_string(), 17.0, 19.0));

        let values = layer.interpolation_values();
        let values = values.as_slice();
        let point = GLYPH_ADVANCE_VALUE_COUNT;
        let anchor = point + GLYPH_POINT_VALUE_COUNT;

        assert_eq!(values.len(), anchor + GLYPH_ANCHOR_VALUE_COUNT);
        assert_eq!(values[GLYPH_ADVANCE_VALUE_OFFSET], 600.0);
        assert_eq!(values[point + position_offset("x")], 11.0);
        assert_eq!(values[point + position_offset("y")], 13.0);
        assert_eq!(values[anchor + position_offset("x")], 17.0);
        assert_eq!(values[anchor + position_offset("y")], 19.0);
    }

    #[test]
    fn generated_file_glyph_value_layout_is_current() {
        let module = TypeScriptModule::new("crates/shift-font/src/interpolation/values.rs")
            .number(
                "Index of the horizontal advance within a glyph's values.",
                "GLYPH_ADVANCE_VALUE_OFFSET",
                GLYPH_ADVANCE_VALUE_OFFSET,
            )
            .number(
                "Leading glyph values holding the horizontal advance.",
                "GLYPH_ADVANCE_VALUE_COUNT",
                GLYPH_ADVANCE_VALUE_COUNT,
            )
            .indices(
                "Offsets of coordinates within one point's or anchor's values.",
                "GLYPH_POSITION_VALUE_OFFSETS",
                &field_indices(&GLYPH_POSITION_VALUE_FIELDS),
            )
            .number(
                "Glyph values per contour point: x, then y.",
                "GLYPH_POINT_VALUE_COUNT",
                GLYPH_POINT_VALUE_COUNT,
            )
            .number(
                "Glyph values per anchor: x, then y.",
                "GLYPH_ANCHOR_VALUE_COUNT",
                GLYPH_ANCHOR_VALUE_COUNT,
            )
            .number(
                "Glyph values per component in the decomposed transform encoding.",
                "DECOMPOSED_COMPONENT_VALUE_COUNT",
                DecomposedTransform::VALUE_COUNT,
            )
            .indices(
                "Offsets of decomposed transform fields within one component's values.",
                "DECOMPOSED_COMPONENT_VALUE_OFFSETS",
                &field_indices(&DecomposedTransform::VALUE_FIELDS),
            )
            .number(
                "Glyph values per component in the affine matrix encoding.",
                "AFFINE_COMPONENT_VALUE_COUNT",
                Transform::VALUE_COUNT,
            )
            .indices(
                "Offsets of affine matrix fields within one component's values.",
                "AFFINE_COMPONENT_VALUE_OFFSETS",
                &field_indices(&Transform::VALUE_FIELDS),
            )
            .finish();

        assert_generated_file("packages/types/src/layout/glyphValues.ts", &module);
    }
}
