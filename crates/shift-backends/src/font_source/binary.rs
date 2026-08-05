use std::path::{Path, PathBuf};
use std::sync::Arc;

use skrifa::prelude::{LocationRef, Size};
use skrifa::raw::types::{GlyphId, MajorMinor, Point as RawPoint};
use skrifa::raw::{ReadError, TableProvider};
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider};

use crate::font_source::{
    AffineTransform, AxisIndex, DirectoryAxisMapping, DirectoryGlyph, DirectoryInstance,
    FontDirectory, FontMetrics, FontReadError, FontSource, GlyphIndex, ProjectedGlyph,
    SourceAtlasError, SourceAtlasPage, VariationAxis, VariationAxisKind,
};
use crate::FontFormat;

mod atlas;
pub use atlas::build_binary_atlas_page;

/// Retained bytes and indexes for one binary TTF, OTF, or variable font.
pub struct BinaryFont {
    path: PathBuf,
    bytes: Arc<[u8]>,
    directory: FontDirectory,
}

impl BinaryFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
        let bytes: Arc<[u8]> = std::fs::read(path)
            .map_err(|source| FontReadError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .into();
        let font = FontRef::new(bytes.as_ref())
            .map_err(|error| malformed(path, format!("failed to parse font: {error}")))?;
        let directory = binary_directory(path, &font)?;
        Ok(Self {
            path: path.to_path_buf(),
            bytes,
            directory,
        })
    }

    pub(crate) fn bytes(&self) -> &Arc<[u8]> {
        &self.bytes
    }
}

impl FontSource for BinaryFont {
    fn directory(&self) -> &FontDirectory {
        &self.directory
    }

    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError> {
        atlas::project_binary_glyph(self, glyph)
    }

    fn atlas_page(
        &self,
        roots: &[GlyphIndex],
        band_count: u32,
    ) -> Result<SourceAtlasPage, SourceAtlasError> {
        build_binary_atlas_page(self, roots, band_count)
    }
}

fn binary_directory(path: &Path, font: &FontRef<'_>) -> Result<FontDirectory, FontReadError> {
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
        format_for_path(path)?,
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
    match font.avar() {
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
        }
        Ok(_) | Err(ReadError::TableIsMissing(_)) => {}
        Err(error) => {
            return Err(malformed(
                path,
                format!("failed to read avar table: {error}"),
            ))
        }
    }
    Ok(directory)
}

fn infer_tuple_deltas(
    points: &[RawPoint<i32>],
    contour_ends: &[u16],
    deltas: &mut [Option<(f64, f64)>],
) -> Result<(), FontReadError> {
    let mut start = 0;
    for end in contour_ends {
        let end = *end as usize;
        if end < start || end >= points.len() || end >= deltas.len() {
            return Err(FontReadError::InvalidProjection {
                details: "variation contour endpoints are invalid".into(),
            });
        }
        let references = (start..=end)
            .filter(|index| deltas[*index].is_some())
            .collect::<Vec<_>>();
        match references.as_slice() {
            [] => {}
            [reference] => {
                let delta = deltas[*reference].expect("reference has a delta");
                for value in &mut deltas[start..=end] {
                    *value = Some(delta);
                }
            }
            _ => {
                for position in 0..references.len() {
                    let first = references[position];
                    let second = references[(position + 1) % references.len()];
                    let mut index = if first == end { start } else { first + 1 };
                    while index != second {
                        let x = interpolate_delta_coordinate(
                            points[index].x,
                            points[first].x,
                            points[second].x,
                            deltas[first].expect("reference has a delta").0,
                            deltas[second].expect("reference has a delta").0,
                        );
                        let y = interpolate_delta_coordinate(
                            points[index].y,
                            points[first].y,
                            points[second].y,
                            deltas[first].expect("reference has a delta").1,
                            deltas[second].expect("reference has a delta").1,
                        );
                        deltas[index] = Some((x, y));
                        index = if index == end { start } else { index + 1 };
                    }
                }
            }
        }
        start = end + 1;
    }
    Ok(())
}

fn interpolate_delta_coordinate(
    point: i32,
    first: i32,
    second: i32,
    first_delta: f64,
    second_delta: f64,
) -> f64 {
    let (first, first_delta, second, second_delta) = if first <= second {
        (first, first_delta, second, second_delta)
    } else {
        (second, second_delta, first, first_delta)
    };
    if first == second {
        return if first_delta == second_delta {
            first_delta
        } else {
            0.0
        };
    }
    if point <= first {
        return first_delta;
    }
    if point >= second {
        return second_delta;
    }
    first_delta
        + (second_delta - first_delta) * f64::from(point - first) / f64::from(second - first)
}

fn component_transform(component: &skrifa::raw::tables::glyf::Component) -> AffineTransform {
    AffineTransform {
        xx: f64::from(component.transform.xx.to_f32()),
        xy: f64::from(component.transform.yx.to_f32()),
        yx: f64::from(component.transform.xy.to_f32()),
        yy: f64::from(component.transform.yy.to_f32()),
        dx: 0.0,
        dy: 0.0,
    }
}

fn approximate_hypot(a: f64, b: f64) -> f64 {
    let a = a.abs();
    let b = b.abs();
    if a > b {
        a + 0.375 * b
    } else {
        b + 0.375 * a
    }
}

fn localized_string(font: &FontRef<'_>, id: StringId) -> Option<String> {
    font.localized_strings(id)
        .english_or_first()
        .map(|string| string.to_string())
        .filter(|string| !string.is_empty())
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

fn malformed(path: &Path, details: String) -> FontReadError {
    FontReadError::MalformedSource {
        format: format_for_path(path).unwrap_or(FontFormat::Ttf),
        path: path.to_path_buf(),
        details,
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
        let font = BinaryFont::open(&fixture("mutatorsans/MutatorSans.ttf")).unwrap();
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
