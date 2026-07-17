use crate::{CoreError, CoreResult, DecomposedTransform, GlyphLayer};

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
            let transform = component.transform();
            values.push(transform.translate_x);
            values.push(transform.translate_y);
            values.push(transform.rotation);
            values.push(transform.scale_x);
            values.push(transform.scale_y);
            values.push(transform.skew_x);
            values.push(transform.skew_y);
            values.push(transform.t_center_x);
            values.push(transform.t_center_y);
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
        let expected = 1
            + self
                .contours_iter()
                .map(|contour| contour.points().len() * 2)
                .sum::<usize>()
            + self.anchors().len() * 2
            + self.components().len() * 9;
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
            component.set_transform(DecomposedTransform {
                translate_x: cursor.next()?,
                translate_y: cursor.next()?,
                rotation: cursor.next()?,
                scale_x: cursor.next()?,
                scale_y: cursor.next()?,
                skew_x: cursor.next()?,
                skew_y: cursor.next()?,
                t_center_x: cursor.next()?,
                t_center_y: cursor.next()?,
            });
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
