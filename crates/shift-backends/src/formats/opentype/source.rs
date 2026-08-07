use std::path::{Path, PathBuf};
use std::sync::Arc;

use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::types::{GlyphId, MajorMinor};
use skrifa::raw::{ReadError, TableProvider};
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider};

use super::localized_string;
use crate::font_source::{
    malformed, AxisIndex, DirectoryAxisMapping, DirectoryGlyph, DirectoryInstance, FontDirectory,
    FontMetrics, FontReadError, FontSource, GlyphIndex, ProjectedGlyph, VariationAxis,
    VariationAxisKind,
};
use crate::FontFormat;

/// Retained bytes and indexes for one OpenType TTF, OTF, or variable font.
pub struct OpenTypeFont {
    pub(super) path: PathBuf,
    bytes: Arc<[u8]>,
    pub(super) directory: FontDirectory,
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
        let (directory, avar_version) = binary_directory(path, &font)?;
        Ok(Self {
            path: path.to_path_buf(),
            bytes,
            directory,
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
) -> Result<(FontDirectory, Option<MajorMinor>), FontReadError> {
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
            DirectoryGlyph {
                index: GlyphIndex::new(index as u32),
                name: names
                    .get(raw_id)
                    .map(|name| name.to_string())
                    .unwrap_or_else(|| format!("gid{index}")),
                unicodes: unicodes.into_boxed_slice(),
            }
        })
        .collect();
    let axes = font
        .axes()
        .iter()
        .enumerate()
        .map(|(index, axis)| VariationAxis {
            index: AxisIndex::new(index as u32),
            tag: axis.tag().to_string(),
            name: localized_string(font, axis.name_id()).unwrap_or_else(|| axis.tag().to_string()),
            hidden: axis.is_hidden(),
            kind: VariationAxisKind::Continuous {
                minimum: axis.min_value() as f64,
                default: axis.default_value() as f64,
                maximum: axis.max_value() as f64,
            },
        })
        .collect();
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let mut directory = FontDirectory::new(
        format,
        localized_string(font, StringId::FAMILY_NAME),
        localized_string(font, StringId::SUBFAMILY_NAME),
        metrics.units_per_em as f64,
        glyphs,
        axes,
    )?;
    directory.set_metrics(FontMetrics {
        units_per_em: metrics.units_per_em as f64,
        ascender: metrics.ascent as f64,
        descender: metrics.descent as f64,
        line_gap: metrics.leading as f64,
        cap_height: metrics.cap_height.map(|value| value as f64),
        x_height: metrics.x_height.map(|value| value as f64),
    });
    directory.set_instances(
        font.named_instances()
            .iter()
            .enumerate()
            .map(|(index, instance)| DirectoryInstance {
                name: localized_string(font, instance.subfamily_name_id())
                    .unwrap_or_else(|| format!("Instance {}", index + 1)),
                location: instance
                    .user_coords()
                    .map(|coordinate| coordinate as f64)
                    .collect::<Vec<_>>()
                    .into_boxed_slice(),
                postscript_name: instance
                    .postscript_name_id()
                    .and_then(|id| localized_string(font, id)),
            })
            .collect(),
    );
    let avar_version = match font.avar() {
        Ok(avar) if avar.version() == MajorMinor::VERSION_1_0 => {
            if avar.axis_count() as usize != directory.axes.len() {
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
                    let axis = &directory.axes[index];
                    let (minimum, default, maximum) = match &axis.kind {
                        VariationAxisKind::Continuous {
                            minimum,
                            default,
                            maximum,
                        } => (*minimum, *default, *maximum),
                        VariationAxisKind::Discrete { .. } => {
                            return Err(malformed(
                                path,
                                "avar mapping references a discrete axis".into(),
                            ))
                        }
                    };
                    let user_value = |normalized: f64| {
                        if normalized < 0.0 {
                            default + normalized * (default - minimum)
                        } else {
                            default + normalized * (maximum - default)
                        }
                    };
                    Ok(DirectoryAxisMapping {
                        axis: AxisIndex::new(index as u32),
                        points: mapping
                            .axis_value_maps()
                            .iter()
                            .map(|value| {
                                (
                                    user_value(f64::from(value.from_coordinate().to_f32())),
                                    user_value(f64::from(value.to_coordinate().to_f32())),
                                )
                            })
                            .collect::<Vec<_>>()
                            .into_boxed_slice(),
                    })
                })
                .collect::<Result<Vec<_>, FontReadError>>()?;
            directory.set_axis_mappings(mappings);
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
    Ok((directory, avar_version))
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
