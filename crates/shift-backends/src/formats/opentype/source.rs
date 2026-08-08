use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::types::{GlyphId, MajorMinor};
use skrifa::raw::{ReadError, TableProvider};
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider};

use super::localized_string;
use crate::font_source::{
    malformed, FontDirectory, FontReadError, FontSource, GlyphIndex, ProjectedGlyph,
};
use crate::metrics::set_metric_position;
use crate::FontFormat;
use shift_font::{
    Axis, AxisMapping, AxisMappingPoint, DesignLocation, ExternalLocation, Font as ShiftFont,
    Location, MetricKind, NamedInstance,
};

/// Retained bytes and indexes for one OpenType TTF, OTF, or variable font.
pub struct OpenTypeFont {
    pub(super) path: PathBuf,
    bytes: Arc<[u8]>,
    pub(super) directory: FontDirectory,
    pub(super) header: ShiftFont,
    pub(super) avar_version: Option<MajorMinor>,
}

impl OpenTypeFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
        let bytes: Arc<[u8]> = std::fs::read(path)
            .map_err(|source| FontReadError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .into();
        let font = FontRef::new(bytes.as_ref())
            .map_err(|error| malformed(path, format!("failed to parse font: {error}")))?;
        let (directory, header, avar_version) = binary_directory(path, &font)?;
        Ok(Self {
            path: path.to_path_buf(),
            bytes,
            directory,
            header,
            avar_version,
        })
    }

    pub(crate) fn bytes(&self) -> &Arc<[u8]> {
        &self.bytes
    }
}

impl FontSource for OpenTypeFont {
    fn directory(&self) -> &FontDirectory {
        &self.directory
    }

    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError> {
        super::inputs::project_binary_glyph(self, glyph)
    }
}

fn binary_directory(
    path: &Path,
    font: &FontRef<'_>,
) -> Result<(FontDirectory, ShiftFont, Option<MajorMinor>), FontReadError> {
    let format = format_for_path(path)?;
    font.hmtx()
        .map_err(|error| malformed(path, format!("failed to read hmtx table: {error}")))?;
    let glyph_count = font
        .maxp()
        .map_err(|error| malformed(path, format!("failed to read maxp table: {error}")))?
        .num_glyphs() as usize;
    let mut unicodes = vec![Vec::new(); glyph_count];
    for (unicode, glyph_id) in font.charmap().mappings() {
        if let Some(values) = unicodes.get_mut(glyph_id.to_u32() as usize) {
            values.push(unicode);
        }
    }
    let names = font.glyph_names();
    let glyphs = unicodes
        .into_iter()
        .enumerate()
        .map(|(index, unicodes)| {
            let raw_id = GlyphId::new(index as u32);
            (
                names
                    .get(raw_id)
                    .map(|name| name.to_string())
                    .unwrap_or_else(|| format!("gid{index}")),
                unicodes.into_boxed_slice(),
            )
        })
        .collect();
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let family_name = localized_string(font, StringId::FAMILY_NAME);
    let style_name = localized_string(font, StringId::SUBFAMILY_NAME);
    let mut header = ShiftFont::new();
    header.metadata_mut().family_name = family_name;
    header.metadata_mut().style_name = style_name.clone();
    header.metrics_mut().units_per_em = metrics.units_per_em as f64;

    let default_source_id = header
        .default_source_id()
        .expect("new font should have a default source");
    let metric_definitions = header.metric_definitions().to_vec();
    let default_source = header
        .source_mut(default_source_id.clone())
        .expect("new font should contain its default source");
    default_source.set_name(style_name.unwrap_or_else(|| "Default".to_string()));
    for (kind, value) in [
        (MetricKind::Ascender, Some(metrics.ascent as f64)),
        (MetricKind::Descender, Some(metrics.descent as f64)),
        (
            MetricKind::CapHeight,
            metrics.cap_height.map(|value| value as f64),
        ),
        (
            MetricKind::XHeight,
            metrics.x_height.map(|value| value as f64),
        ),
    ] {
        set_metric_position(&metric_definitions, default_source, kind, value);
    }
    default_source.set_line_gap(Some(metrics.leading as f64));

    let mut axis_ids = Vec::new();
    let mut default_location = DesignLocation::new();
    for source_axis in font.axes().iter() {
        let mut axis = Axis::new(
            source_axis.tag().to_string(),
            localized_string(font, source_axis.name_id())
                .unwrap_or_else(|| source_axis.tag().to_string()),
            source_axis.min_value() as f64,
            source_axis.default_value() as f64,
            source_axis.max_value() as f64,
        );
        axis.set_hidden(source_axis.is_hidden());
        let axis_id = axis.id();
        default_location.set(axis_id.clone(), source_axis.default_value() as f64);
        header
            .add_axis(axis)
            .map_err(|error| malformed(path, error.to_string()))?;
        axis_ids.push(axis_id);
    }
    header
        .source_mut(default_source_id)
        .expect("new font should contain its default source")
        .set_location(default_location);

    let avar_version = match font.avar() {
        Ok(avar) if avar.version() == MajorMinor::VERSION_1_0 => {
            if avar.axis_count() as usize != axis_ids.len() {
                return Err(malformed(
                    path,
                    "avar axis count does not match fvar".into(),
                ));
            }
            let mappings = avar
                .axis_segment_maps()
                .iter()
                .enumerate()
                .map(|(index, mapping)| {
                    let mapping = mapping.map_err(|error| {
                        malformed(path, format!("failed to read avar segment map: {error}"))
                    })?;
                    let axis = &header.axes()[index];
                    let axis_id = axis_ids[index].clone();
                    let minimum = axis.minimum();
                    let default = axis.default();
                    let maximum = axis.maximum();
                    let user_value = |normalized: f64| {
                        if normalized < 0.0 {
                            default + normalized * (default - minimum)
                        } else {
                            default + normalized * (maximum - default)
                        }
                    };
                    Ok(AxisMapping::new(
                        format!("{} mapping", axis.name()),
                        vec![axis_id.clone()],
                        vec![axis_id.clone()],
                        mapping
                            .axis_value_maps()
                            .iter()
                            .map(|value| AxisMappingPoint {
                                description: None,
                                input: Location::from_map(HashMap::from([(
                                    axis_id.clone(),
                                    user_value(f64::from(value.from_coordinate().to_f32())),
                                )])),
                                output: Location::from_map(HashMap::from([(
                                    axis_id.clone(),
                                    user_value(f64::from(value.to_coordinate().to_f32())),
                                )])),
                            })
                            .collect(),
                    ))
                })
                .collect::<Result<Vec<_>, FontReadError>>()?;
            header
                .set_axis_mappings(mappings)
                .map_err(|error| malformed(path, error.to_string()))?;
            Some(avar.version())
        }
        Ok(avar) => Some(avar.version()),
        Err(ReadError::TableIsMissing(_)) => None,
        Err(error) => {
            return Err(malformed(
                path,
                format!("failed to read avar table: {error}"),
            ))
        }
    };

    let instances = font
        .named_instances()
        .iter()
        .enumerate()
        .map(|(index, instance)| {
            let location = ExternalLocation::from_map(
                axis_ids
                    .iter()
                    .cloned()
                    .zip(instance.user_coords().map(|coordinate| coordinate as f64))
                    .collect(),
            );
            NamedInstance::new(
                localized_string(font, instance.subfamily_name_id())
                    .unwrap_or_else(|| format!("Instance {}", index + 1)),
                location,
                instance
                    .postscript_name_id()
                    .and_then(|id| localized_string(font, id)),
            )
        })
        .collect();
    header
        .set_named_instances(instances)
        .map_err(|error| malformed(path, error.to_string()))?;

    let (directory, _) = FontDirectory::from_font(format, &header, glyphs)?;
    Ok((directory, header, avar_version))
}

fn format_for_path(path: &Path) -> Result<FontFormat, FontReadError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("ttf") => Ok(FontFormat::Ttf),
        Some("otf") => Ok(FontFormat::Otf),
        _ => Err(FontReadError::UnsupportedFormat {
            path: path.to_path_buf(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font_source::GlyphPointKind;

    fn fixture(path: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("fixtures/fonts")
            .join(path)
    }

    #[test]
    fn retained_true_type_projection_infers_smooth_points() {
        let font = OpenTypeFont::open(&fixture("mutatorsans/MutatorSans.ttf")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let projected = font.glyph(glyph.index).unwrap();

        assert!(projected
            .root
            .fallback
            .contours
            .iter()
            .flat_map(|contour| contour.points.iter())
            .any(|point| point.kind == GlyphPointKind::OnCurve && point.smooth));
    }
}
