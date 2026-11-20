//! Stroke intents for hand-testing on `explore/strokes` (no editor UI).

use miette::{Result, miette};
use shift_font::stroke::{
    ContourStrokeRole, OutlineStrokeStyle, StrokeCap, StrokeJoin, preview_bounds,
};
use shift_font::{
    BakeStrokeOutlines, ContourId, FontIntentSet, LayerId, OffsetContour, OutlineStroke,
    SetLiveStroke,
};

use crate::cli::{
    BakeStrokeArgs, OffsetContourArgs, OutlineStrokeArgs, SetLiveStrokeArgs, StrokeGlyphLayerArgs,
    StrokePreviewArgs,
};
use crate::selector::FontSelectors;

use super::glyph::load_font;
use super::{AuthoringReport, apply_mutation};

fn resolve_layer(args: &StrokeGlyphLayerArgs) -> Result<(shift_font::Font, LayerId)> {
    let font = load_font(&args.path)?;
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let source_id = match &args.source {
        Some(selector) => font.source_id_for(selector)?,
        None => font
            .default_source_id()
            .ok_or_else(|| miette!("font has no default source"))?,
    };
    let layer_id = font
        .layer_id_for_source(glyph_id, source_id)
        .ok_or_else(|| {
            miette!(
                "glyph {:?} has no layer at source {:?}",
                args.glyph,
                args.source.as_deref().unwrap_or("default")
            )
        })?;
    Ok((font, layer_id))
}

fn contour_ids_on_layer(font: &shift_font::Font, layer_id: LayerId) -> Result<Vec<ContourId>> {
    let layer = font
        .layer(layer_id)
        .ok_or_else(|| miette!("layer {layer_id} is missing"))?;
    Ok(layer.contours_iter().map(shift_font::Contour::id).collect())
}

fn style_from_args(
    width: f64,
    cap: StrokeCap,
    join: StrokeJoin,
    miter_limit: f64,
) -> OutlineStrokeStyle {
    OutlineStrokeStyle {
        width,
        cap,
        join,
        miter_limit,
    }
}

/// # Errors
///
/// Reports selector, geometry, and persistence failures.
pub(crate) fn outline_stroke(args: &OutlineStrokeArgs) -> Result<AuthoringReport> {
    let (font, layer_id) = resolve_layer(&args.target)?;
    let contour_ids = contour_ids_on_layer(&font, layer_id)?;
    if contour_ids.is_empty() {
        return Err(miette!("glyph layer has no contours to stroke"));
    }
    let style = style_from_args(args.width, args.cap, args.join, args.miter_limit);
    let set = FontIntentSet::from(OutlineStroke {
        layer_id,
        contour_ids,
        style,
        tolerance: args.tolerance,
    });
    apply_mutation(&args.target.path, &args.mutation, &set)
}

/// # Errors
///
/// Reports selector, geometry, and persistence failures.
pub(crate) fn offset_contour(args: &OffsetContourArgs) -> Result<AuthoringReport> {
    let (font, layer_id) = resolve_layer(&args.target)?;
    let contour_ids = contour_ids_on_layer(&font, layer_id)?;
    let contour_id = contour_ids.first().cloned().ok_or_else(|| {
        miette!("glyph layer has no closed contour to offset; add a closed path first")
    })?;
    let set = FontIntentSet::from(OffsetContour {
        layer_id,
        contour_id,
        distance: args.distance,
        join: args.join,
        miter_limit: args.miter_limit,
        tolerance: args.tolerance,
    });
    apply_mutation(&args.target.path, &args.mutation, &set)
}

/// # Errors
///
/// Reports selector and persistence failures.
pub(crate) fn set_live_stroke(args: &SetLiveStrokeArgs) -> Result<AuthoringReport> {
    let (font, layer_id) = resolve_layer(&args.target)?;
    let contour_ids = contour_ids_on_layer(&font, layer_id)?;
    if contour_ids.is_empty() {
        return Err(miette!("glyph layer has no contours for live stroke"));
    }
    let style = style_from_args(args.width, args.cap, args.join, args.miter_limit);
    let set = FontIntentSet::from(SetLiveStroke {
        layer_id,
        contour_ids,
        style,
    });
    apply_mutation(&args.target.path, &args.mutation, &set)
}

/// # Errors
///
/// Reports selector and persistence failures.
pub(crate) fn bake_stroke(args: &BakeStrokeArgs) -> Result<AuthoringReport> {
    let (font, layer_id) = resolve_layer(&args.target)?;
    let layer = font.layer(layer_id).unwrap();
    let Some(stroke_lib) = layer.stroke_lib() else {
        return Err(miette!("layer has no live stroke metadata to bake"));
    };
    let contour_ids: Vec<_> = stroke_lib
        .contours
        .iter()
        .filter(|(_, entry)| {
            entry.role == ContourStrokeRole::Skeleton && entry.outline_style.is_some()
        })
        .map(|(id, _)| ContourId::from_raw(id))
        .collect();
    if contour_ids.is_empty() {
        return Err(miette!("no live stroke skeletons with inline outlineStyle"));
    }
    let set = FontIntentSet::from(BakeStrokeOutlines {
        layer_id,
        contour_ids,
        tolerance: args.tolerance,
    });
    apply_mutation(&args.target.path, &args.mutation, &set)
}

/// Returns JSON preview bounds without mutating the document.
///
/// # Errors
///
/// Reports selector or stroke solver failures.
pub(crate) fn stroke_preview(args: &StrokePreviewArgs) -> Result<String> {
    let (font, layer_id) = resolve_layer(&args.target)?;
    let layer = font.layer(layer_id).unwrap();
    let previews = layer
        .stroke_outlines_for_preview(args.tolerance)
        .map_err(|error| miette!("{error}"))?;
    let lines: Vec<_> = previews
        .iter()
        .map(|preview| {
            let (width, height) = preview_bounds(preview);
            format!(
                "{{\"skeleton\":\"{}\",\"outlineCount\":{},\"width\":{width:.2},\"height\":{height:.2}}}",
                preview.skeleton_contour_id,
                preview.outlines.len()
            )
        })
        .collect();
    Ok(format!("[{}]", lines.join(",")))
}
