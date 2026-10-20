//! Layer payload parsing and lowering to semantic replacement intents.

use shift_font::ReplaceGlyphLayerContent;
use std::io::{self, Read};
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, bail};
use serde::de::DeserializeOwned;
use shift_font::{
    Anchor, Component, Contour, DecomposedTransform, FontIntent, GlyphId, LayerId, PointType,
    Transform,
};
use svgtypes::{PathParser, PathSegment, SimplePathSegment, SimplifyingPathParser};

use super::input::{LayerInput, TransformInput};
use super::require_finite;

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
    /// Lowers a complete drawing payload, minting every internal identity.
    ///
    /// Outlines use font units with Y up; explicit contours and SVG are mutually exclusive.
    /// Components name their base glyph, which `base_glyph` resolves to its identity.
    ///
    /// # Errors
    ///
    /// Rejects non-finite coordinates, mixed outline formats, malformed SVG, SVG arcs,
    /// and components whose base `base_glyph` cannot resolve.
    pub(super) fn into_intent(
        self,
        layer_id: LayerId,
        base_glyph: &dyn Fn(&str) -> Result<GlyphId>,
    ) -> Result<FontIntent> {
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
            components.push(Component::with_transform(
                base_glyph_id,
                input.base,
                transform,
            ));
        }

        Ok(FontIntent::ReplaceGlyphLayerContent(
            ReplaceGlyphLayerContent {
                layer_id,
                width: self.advance,
                contours,
                anchors,
                components,
            },
        ))
    }
}

fn contours_from_svg_path(svg_path: &str) -> Result<Vec<Contour>> {
    // Reject arcs before the simplifying parser can approximate them with cubics.
    for segment in PathParser::from(svg_path) {
        if matches!(
            segment.into_diagnostic()?,
            PathSegment::EllipticalArc { .. }
        ) {
            bail!("svgPath arc commands (A/a) are unsupported; use cubic or quadratic curves");
        }
    }

    let mut contours = Vec::<Contour>::new();
    for segment in SimplifyingPathParser::from(svg_path) {
        let segment = segment.into_diagnostic().wrap_err("invalid svgPath")?;
        if let SimplePathSegment::MoveTo { x, y } = segment {
            require_finite(x, "svgPath x")?;
            require_finite(y, "svgPath y")?;
            let mut contour = Contour::new();
            contour.add_point(x, y, PointType::OnCurve, false);
            contours.push(contour);
            continue;
        }
        let contour = contours
            .last_mut()
            .ok_or_else(|| miette::miette!("svgPath must begin with M or m"))?;
        match segment {
            SimplePathSegment::LineTo { x, y } => {
                contour.add_point(x, y, PointType::OnCurve, false);
            }
            SimplePathSegment::CurveTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => {
                contour.add_point(x1, y1, PointType::OffCurve, false);
                contour.add_point(x2, y2, PointType::OffCurve, false);
                contour.add_point(x, y, PointType::OnCurve, false);
            }
            SimplePathSegment::Quadratic { x1, y1, x, y } => {
                contour.add_point(x1, y1, PointType::OffCurve, false);
                contour.add_point(x, y, PointType::QCurve, false);
            }
            SimplePathSegment::ClosePath => contour.close(),
            SimplePathSegment::MoveTo { .. } => unreachable!("move starts a new contour"),
        }
    }
    for contour in &contours {
        for point in contour.points() {
            require_finite(point.x(), "svgPath x")?;
            require_finite(point.y(), "svgPath y")?;
        }
    }

    Ok(contours)
}
