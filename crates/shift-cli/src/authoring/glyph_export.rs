//! Reads glyphs out of any font source as the JSON batch `glyph set` applies.

use std::collections::HashSet;
use std::path::Path;

use miette::{IntoDiagnostic, Result, WrapErr, bail, miette};
use serde_json::{Map, Value, json};
use shift_backends::font_loader::FontLoader;
use shift_font::{Font, Glyph, GlyphLayer, PointType, SourceId};

use super::glyph_batch::GLYPH_BATCH_FORMAT;

/// Which of a font's sources to read layers from.
pub(crate) enum ExportSources {
    /// The default source, written without a source name so `glyph set` uses the
    /// target's default.
    Default,
    /// One source by name, also written for the target's default source.
    Named(String),
    /// Every source, each layer written with its source's name.
    All,
}

/// Reads `names` and every glyph their components use from the font at `path`, as a
/// glyph batch: names, Unicode values, and each layer's advance, outlines, anchors,
/// and components.
///
/// # Errors
///
/// Fails when the font cannot be read, a requested glyph or source does not exist,
/// or no glyphs were requested.
pub(crate) fn export_glyphs(
    path: &Path,
    names: &[String],
    sources: &ExportSources,
) -> Result<Value> {
    if names.is_empty() {
        bail!("name at least one glyph to export");
    }
    let path_text = path
        .to_str()
        .ok_or_else(|| miette!("font path is not valid UTF-8"))?;
    let font = FontLoader::new()
        .read_font(path_text)
        .into_diagnostic()
        .wrap_err_with(|| format!("failed to load font {}", path.display()))?;
    let source_ids = selected_sources(&font, sources)?;
    let named = matches!(sources, ExportSources::All);

    let mut entries = Vec::new();
    let mut queued: Vec<String> = names.to_vec();
    let mut seen = HashSet::new();
    while let Some(name) = queued.pop() {
        if !seen.insert(name.clone()) {
            continue;
        }
        let glyph = font
            .glyph_by_name(&name)
            .ok_or_else(|| miette!("glyph {name:?} does not exist in {}", path.display()))?;
        let mut wrote_layer = false;
        for source_id in &source_ids {
            let Some(layer) = glyph.layer_for_source(source_id) else {
                continue;
            };
            for (_, component) in layer.components().iter() {
                queued.push(component.base_glyph_name().to_string());
            }
            let source_name = named
                .then(|| {
                    font.source(source_id)
                        .map(|source| source.name().to_string())
                })
                .flatten();
            entries.push(glyph_entry(glyph, Some(layer), source_name));
            wrote_layer = true;
        }
        if !wrote_layer {
            entries.push(glyph_entry(glyph, None, None));
        }
    }
    entries.reverse();

    Ok(json!({ "format": GLYPH_BATCH_FORMAT, "glyphs": entries }))
}

fn selected_sources(font: &Font, sources: &ExportSources) -> Result<Vec<SourceId>> {
    match sources {
        ExportSources::Default => font
            .default_source_id()
            .map(|id| vec![id])
            .ok_or_else(|| miette!("the font has no default source")),
        ExportSources::Named(name) => font
            .sources()
            .iter()
            .find(|source| source.name() == name)
            .map(|source| vec![source.id()])
            .ok_or_else(|| miette!("source {name:?} does not exist")),
        ExportSources::All => Ok(font.sources().iter().map(shift_font::Source::id).collect()),
    }
}

fn glyph_entry(glyph: &Glyph, layer: Option<&GlyphLayer>, source: Option<String>) -> Value {
    let mut entry = Map::new();
    entry.insert("name".into(), json!(glyph.name()));
    if !glyph.unicodes().is_empty() {
        let unicodes: Vec<String> = glyph
            .unicodes()
            .iter()
            .map(|unicode| format!("U+{unicode:04X}"))
            .collect();
        entry.insert("unicodes".into(), json!(unicodes));
    }
    if let Some(source) = source {
        entry.insert("source".into(), json!(source));
    }
    if let Some(layer) = layer {
        entry.insert("layer".into(), layer_value(layer));
    }
    Value::Object(entry)
}

fn layer_value(layer: &GlyphLayer) -> Value {
    let contours: Vec<Value> = layer
        .contours()
        .iter()
        .map(|(_, contour)| {
            let points: Vec<Value> = contour
                .points()
                .iter()
                .map(|point| {
                    let mut value = Map::new();
                    value.insert("x".into(), json!(point.x()));
                    value.insert("y".into(), json!(point.y()));
                    if point.point_type() != PointType::OnCurve {
                        value.insert("pointType".into(), json!(point.point_type()));
                    }
                    if point.is_smooth() {
                        value.insert("smooth".into(), json!(true));
                    }
                    Value::Object(value)
                })
                .collect();
            json!({ "closed": contour.is_closed(), "points": points })
        })
        .collect();

    let mut value = Map::new();
    value.insert("advance".into(), json!(layer.width()));
    if !contours.is_empty() {
        value.insert("contours".into(), json!(contours));
    }
    let anchors: Vec<Value> = layer
        .anchors()
        .iter()
        .map(|anchor| json!({ "name": anchor.name(), "x": anchor.x(), "y": anchor.y() }))
        .collect();
    if !anchors.is_empty() {
        value.insert("anchors".into(), json!(anchors));
    }
    let components: Vec<Value> = layer
        .components()
        .iter()
        .map(|(_, component)| {
            let mut value = Map::new();
            value.insert(
                "base".into(),
                json!(component.base_glyph_name().to_string()),
            );
            if !component.transform().is_identity() {
                value.insert("transform".into(), json!(component.transform()));
            }
            Value::Object(value)
        })
        .collect();
    if !components.is_empty() {
        value.insert("components".into(), json!(components));
    }
    Value::Object(value)
}
