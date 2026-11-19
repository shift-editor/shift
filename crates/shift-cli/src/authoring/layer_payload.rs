//! Layer payload parsing and lowering to semantic replacement intents.

use shift_font::ReplaceGlyphLayerContent;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read};
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, bail};
use serde::de::DeserializeOwned;
use shift_font::svg_path;
use shift_font::{
    Anchor, Component, Contour, DecomposedTransform, DesignLocation, Font, FontIntent, GlyphId,
    LayerId, Transform,
};
use svgtypes::{PathParser, PathSegment};

use super::input::{LayerInput, TransformInput};
use super::metrics_keys::WrittenKey;
use super::require_finite;
use super::swap::parse_when;

/// A component location keyed by axis tag, as design coordinates on `font`'s
/// axes and the base glyph's own axes.
fn component_location(
    values: &BTreeMap<String, f64>,
    font: &Font,
    base_glyph_id: GlyphId,
) -> Result<DesignLocation> {
    values
        .iter()
        .map(|(tag, value)| {
            require_finite(*value, "component location")?;
            let axis_id = font
                .axis_id_in_glyph_space(Some(base_glyph_id), tag)
                .ok_or_else(|| {
                    miette::miette!("the font and the base glyph have no axis tagged {tag:?}")
                })?;
            Ok((axis_id, *value))
        })
        .collect()
}

pub(super) fn read_json_input<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T> {
    let json = if path == Path::new("-") {
        let mut json = String::new();
        io::stdin()
            .read_to_string(&mut json)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read {label} from stdin"))?;
        json
    } else {
        std::fs::read_to_string(path)
            .into_diagnostic()
            .wrap_err_with(|| format!("failed to read {label} from {}", path.display()))?
    };

    serde_json::from_str(&json)
        .into_diagnostic()
        .wrap_err_with(|| format!("invalid {label} from {}", path.display()))
}

impl LayerInput {
    /// Lowers a complete drawing payload, minting every internal identity, then the
    /// layer's own metrics keys, recording each in `written`.
    ///
    /// Outlines use font units with Y up; explicit contours and SVG are mutually exclusive.
    /// Components name their base glyph, which `base_glyph` resolves to its identity,
    /// and the axes of their location by tag, which `font` resolves.
    ///
    /// # Errors
    ///
    /// Rejects non-finite coordinates, mixed outline formats, malformed SVG, SVG arcs,
    /// components whose base `base_glyph` cannot resolve, and component locations on
    /// axes neither the font nor the base glyph has.
    pub(super) fn into_intents(
        self,
        glyph_id: GlyphId,
        layer_id: LayerId,
        base_glyph: &dyn Fn(&str) -> Result<GlyphId>,
        font: &Font,
        written: &mut BTreeSet<WrittenKey>,
    ) -> Result<Vec<FontIntent>> {
        require_finite(self.advance, "layer advance")?;
        let contours = match (self.contours, self.svg_path) {
            (Some(_), Some(_)) => bail!("use contours or svgPath, not both"),
            (_, Some(svg_path)) => contours_from_svg_path(&svg_path)?,
            (contours, None) => {
                let mut result = Vec::new();
                for input in contours.unwrap_or_default() {
                    let mut contour = Contour::new();
                    if input.closed {
                        contour.close();
                    }
                    for point in input.points {
                        require_finite(point.x, "point x")?;
                        require_finite(point.y, "point y")?;
                        contour.add_point(point.x, point.y, point.point_type, point.smooth);
                    }
                    result.push(contour);
                }
                result
            }
        };
        let anchors = self
            .anchors
            .into_iter()
            .map(|anchor| {
                require_finite(anchor.x, "anchor x")?;
                require_finite(anchor.y, "anchor y")?;
                Ok(Anchor::new(anchor.name, anchor.x, anchor.y))
            })
            .collect::<Result<Vec<_>>>()?;

        let mut components = Vec::with_capacity(self.components.len());
        for input in self.components {
            let base_glyph_id = base_glyph(&input.base)
                .wrap_err_with(|| format!("component base {:?}", input.base))?;
            let transform = match input.transform {
                None => DecomposedTransform::identity(),
                Some(TransformInput::Decomposed(transform)) => transform,
                Some(TransformInput::Affine([xx, xy, yx, yy, dx, dy])) => {
                    for value in [xx, xy, yx, yy, dx, dy] {
                        require_finite(value, "component transform")?;
                    }
                    DecomposedTransform::from_matrix(&Transform {
                        xx,
                        xy,
                        yx,
                        yy,
                        dx,
                        dy,
                    })
                }
            };
            let location = component_location(&input.location, font, base_glyph_id)
                .wrap_err_with(|| format!("component {:?} location", input.base))?;
            let condition = parse_when(font, Some(glyph_id), &input.condition)
                .wrap_err_with(|| format!("component {:?} condition", input.base))?;
            let mut component = Component::with_transform(base_glyph_id, input.base, transform);
            component.set_location(location);
            component.set_inheritance(input.inheritance);
            component.set_condition(condition);
            components.push(component);
        }

        let mut intents = vec![
            ReplaceGlyphLayerContent {
                layer_id,
                width: self.advance,
                contours,
                anchors,
                components,
            }
            .into(),
        ];
        if let Some(keys) = &self.metrics_keys {
            intents.extend(keys.layer_intents(glyph_id, layer_id, written));
        }
        Ok(intents)
    }
}

fn contours_from_svg_path(svg_path: &str) -> Result<Vec<Contour>> {
    // Reject arcs before the shared parser approximates them with cubics.
    for segment in PathParser::from(svg_path) {
        if matches!(
            segment.into_diagnostic()?,
            PathSegment::EllipticalArc { .. }
        ) {
            bail!("svgPath arc commands (A/a) are unsupported; use cubic or quadratic curves");
        }
    }

    svg_path::contours_from_svg_path(svg_path)
        .into_diagnostic()
        .wrap_err("invalid svgPath")
}
