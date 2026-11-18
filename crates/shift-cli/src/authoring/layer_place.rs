//! Where a glyph's drawings sit, and the commands that move and remove them.
//!
//! A drawing sits exactly on a source, or at a location: coordinates on font
//! axes and the glyph's own axes, laid over a base source or, without one,
//! with every axis they don't name at its default.

use std::collections::BTreeMap;

use miette::{IntoDiagnostic, Result, miette};
use shift_font::{
    AxisValueUse, CoreError, CreateGlyphLayer, CreateLocatedGlyphLayer, DeleteGlyphLayer,
    DesignLocation, Font, FontIntent, FontIntentSet, GlyphId, LayerId, LayerLocation,
    SetGlyphLayerLocation, SourceId,
};

use crate::cli::{LayerPlaceArgs, MoveLayerArgs, RemoveLayerArgs};
use crate::selector::FontSelectors;

use super::glyph::load_font;
use super::{AuthoringReport, apply_mutation, parse_coordinates, require_finite};

/// The place `source` and `coordinates` name for a drawing of `glyph_id`:
/// exactly on `source` without coordinates, else the coordinates laid over
/// `source`, or over no source without one. Tags name font axes or the
/// glyph's own axes.
///
/// # Errors
///
/// Rejects an unknown source or axis tag, malformed coordinates, and a place
/// with neither a source nor coordinates.
pub(super) fn layer_location(
    font: &Font,
    glyph_id: Option<GlyphId>,
    source: Option<&str>,
    coordinates: &[String],
) -> Result<LayerLocation> {
    let base = source
        .map(|selector| font.source_id_for(selector))
        .transpose()?;
    let coordinates = parse_coordinates(coordinates, |tag| {
        font.axis_id_in_glyph_space(glyph_id, tag)
    })?;
    if base.is_none() && coordinates.is_empty() {
        return Err(miette!("a drawing needs a source, a location, or both"));
    }
    Ok(LayerLocation::new(base, coordinates.into_iter().collect()))
}

/// As [`layer_location`], with tagged values as `glyph set` reads them.
///
/// # Errors
///
/// Rejects an unknown axis tag and a non-finite value.
pub(super) fn layer_location_from_values(
    font: &Font,
    glyph_id: Option<GlyphId>,
    base: Option<SourceId>,
    values: &BTreeMap<String, f64>,
) -> Result<LayerLocation> {
    let coordinates: DesignLocation = values
        .iter()
        .map(|(tag, value)| {
            require_finite(*value, &format!("location value for axis tag {tag:?}"))?;
            let axis_id = font
                .axis_id_in_glyph_space(glyph_id, tag)
                .ok_or_else(|| miette!("axis tag {tag:?} does not exist"))?;
            Ok((axis_id, *value))
        })
        .collect::<Result<_>>()?;
    Ok(LayerLocation::new(base, coordinates))
}

/// A glyph's drawing as the command line names it: the glyph, and where the
/// drawing sits.
pub(super) struct PlacedLayer {
    pub glyph_id: GlyphId,
    pub location: LayerLocation,
}

impl LayerPlaceArgs {
    /// The glyph these flags name and the place they name for its drawing.
    pub(super) fn resolve(&self, font: &Font) -> Result<PlacedLayer> {
        let glyph_id = font.glyph_id_for(&self.glyph)?;
        let location =
            layer_location(font, Some(glyph_id), self.source.as_deref(), &self.location)?;
        Ok(PlacedLayer { glyph_id, location })
    }

    /// The drawing these flags name, which must exist.
    fn require_layer(&self, font: &Font) -> Result<LayerId> {
        let PlacedLayer { glyph_id, location } = self.resolve(font)?;
        layer_at(font, glyph_id, &location).ok_or_else(|| {
            miette!(
                "glyph {:?} has no drawing at {}",
                self.glyph,
                describe(font, &location)
            )
        })
    }
}

/// The drawing of `glyph_id` that sits exactly at `location`.
pub(super) fn layer_at(
    font: &Font,
    glyph_id: GlyphId,
    location: &LayerLocation,
) -> Option<LayerId> {
    font.glyph(glyph_id)?
        .layers()
        .values()
        .find(|layer| layer.location() == location)
        .map(|layer| layer.id())
}

/// The intent that creates an empty drawing `layer_id` of `glyph_id` at
/// `location`.
pub(super) fn create_layer(
    layer_id: LayerId,
    glyph_id: GlyphId,
    location: &LayerLocation,
) -> FontIntent {
    match location.exact_source_id() {
        Some(source_id) => CreateGlyphLayer {
            layer_id,
            glyph_id,
            source_id,
        }
        .into(),
        None => CreateLocatedGlyphLayer {
            layer_id,
            glyph_id,
            base_source_id: location.base_source_id(),
            coordinates: location.coordinates().clone(),
        }
        .into(),
    }
}

/// A place as a person reads it: `Regular`, `Regular + SPRD=100`, `BLED=50`.
fn describe(font: &Font, location: &LayerLocation) -> String {
    let base = location
        .base_source(font)
        .map(|source| source.name().to_string());
    let coordinates: Vec<String> = location
        .coordinates()
        .iter()
        .map(|(axis_id, value)| {
            let tag = font
                .axis(*axis_id)
                .map(|axis| axis.tag().to_string())
                .or_else(|| font.glyph_axis(*axis_id).map(|axis| axis.tag().to_string()))
                .unwrap_or_else(|| axis_id.to_string());
            format!("{tag}={value}")
        })
        .collect();
    match (base, coordinates.is_empty()) {
        (Some(base), true) => base,
        (Some(base), false) => format!("{base} + {}", coordinates.join(",")),
        (None, _) => coordinates.join(","),
    }
}

/// Moves one drawing to a new place, keeping its content and identity.
///
/// # Errors
///
/// Rejects selectors that name no drawing, and a place another drawing of
/// the glyph already holds or that leaves its design space or an axis range.
pub(crate) fn move_layer(args: &MoveLayerArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let layer_id = args.layer.require_layer(&font)?;
    let glyph_id = font.require_layer_owner(layer_id).into_diagnostic()?;
    let to = layer_location(
        &font,
        Some(glyph_id),
        args.to_source.as_deref(),
        &args.to_location,
    )?;
    let set = FontIntentSet::from(SetGlyphLayerLocation {
        layer_id,
        base_source_id: to.base_source_id(),
        coordinates: to.coordinates().clone(),
    });

    apply_mutation(&args.path, &args.mutation, &set)
}

/// Removes one drawing, wherever it sits.
///
/// # Errors
///
/// Rejects selectors that name no drawing.
pub(crate) fn remove_layer(args: &RemoveLayerArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let layer_id = args.layer.require_layer(&font)?;

    apply_mutation(
        &args.path,
        &args.mutation,
        &FontIntentSet::from(DeleteGlyphLayer { layer_id }),
    )
}

/// The values an axis edit was refused over, one line each, naming the glyph
/// and the drawing or component that holds each value. `None` for any other
/// error.
pub(super) fn refused_values(font: &Font, error: &CoreError) -> Option<String> {
    let (axis_id, uses, reason) = match error {
        CoreError::AxisValuesOutsideRange { axis_id, uses } => {
            (axis_id, uses, "would fall outside its range")
        }
        CoreError::GlyphAxisInUse { axis_id, uses } => (axis_id, uses, "still use it"),
        _ => return None,
    };
    let tag = font
        .glyph_axis(*axis_id)
        .map_or_else(|| axis_id.to_string(), |axis| axis.tag().to_string());
    let glyph_name = |glyph_id: GlyphId| {
        font.glyph(glyph_id)
            .map_or_else(|| glyph_id.to_string(), |glyph| glyph.name().to_string())
    };
    let place = |layer_id: LayerId| {
        font.layer(layer_id).map_or_else(
            || layer_id.to_string(),
            |layer| describe(font, layer.location()),
        )
    };
    let mut lines = vec![format!("these values on axis {tag} {reason}:")];
    for value_use in uses {
        lines.push(match value_use {
            AxisValueUse::Layer {
                glyph_id,
                layer_id,
                value,
            } => format!(
                "  {} drawing at {}: {tag}={value}",
                glyph_name(*glyph_id),
                place(*layer_id)
            ),
            AxisValueUse::Component {
                glyph_id,
                layer_id,
                component_id,
                value,
            } => format!(
                "  {} component {component_id} in its drawing at {}: {tag}={value}",
                glyph_name(*glyph_id),
                place(*layer_id)
            ),
        });
    }
    Some(lines.join("\n"))
}
