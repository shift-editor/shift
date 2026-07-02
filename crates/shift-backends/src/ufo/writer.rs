use crate::errors::{FormatBackendError, FormatBackendResult};
use crate::traits::{FontView, FontWriter};
use norad::{Font as NoradFont, Glyph as NoradGlyph, Line, Name};
use shift_font::{
    Contour, Font, Glyph, GlyphLayer, Guideline, KerningSide, LibData, LibValue, Point, PointType,
};
use std::path::Path;

pub struct UfoWriter;

fn ufo_name(kind: &'static str, name: &str) -> FormatBackendResult<Name> {
    Name::new(name).map_err(|_| FormatBackendError::UfoName {
        kind,
        name: name.to_string(),
    })
}

fn io_error(action: &str, path: &Path, error: std::io::Error) -> FormatBackendError {
    FormatBackendError::Ufo(format!("failed to {action} '{}': {error}", path.display()))
}

#[cfg(unix)]
fn sync_parent(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::File::open(parent)?.sync_all()?;
        }
    }
    Ok(())
}

// Windows cannot open directory handles this way; NTFS journals metadata itself.
#[cfg(not(unix))]
fn sync_parent(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Fsyncs every file under `root`, then each directory bottom-up, so the
/// staged UFO is durable before it is renamed into place.
#[cfg(unix)]
fn sync_tree(root: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            sync_tree(&path)?;
        } else {
            std::fs::File::open(&path)?.sync_all()?;
        }
    }
    std::fs::File::open(root)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_tree(_root: &Path) -> std::io::Result<()> {
    Ok(())
}

impl UfoWriter {
    pub fn new() -> Self {
        Self
    }

    fn convert_point_type(
        point: &Point,
        index: usize,
        points: &[Point],
        is_closed: bool,
    ) -> norad::PointType {
        match point.point_type() {
            PointType::OffCurve => norad::PointType::OffCurve,
            PointType::QCurve => norad::PointType::QCurve,
            PointType::OnCurve => {
                if index == 0 && !is_closed {
                    norad::PointType::Move
                } else if index > 0 {
                    let prev_index = index - 1;
                    if matches!(points[prev_index].point_type(), PointType::OffCurve) {
                        norad::PointType::Curve
                    } else {
                        norad::PointType::Line
                    }
                } else if is_closed && !points.is_empty() {
                    let last = &points[points.len() - 1];
                    if matches!(last.point_type(), PointType::OffCurve) {
                        norad::PointType::Curve
                    } else {
                        norad::PointType::Line
                    }
                } else {
                    norad::PointType::Line
                }
            }
        }
    }

    fn convert_contour(contour: &Contour) -> norad::Contour {
        let points: Vec<norad::ContourPoint> = contour
            .points()
            .iter()
            .enumerate()
            .map(|(i, p)| {
                norad::ContourPoint::new(
                    p.x(),
                    p.y(),
                    Self::convert_point_type(p, i, contour.points(), contour.is_closed()),
                    p.is_smooth(),
                    None,
                    None,
                )
            })
            .collect();

        norad::Contour::new(points, None)
    }

    fn convert_component(
        component: &shift_font::Component,
    ) -> FormatBackendResult<norad::Component> {
        let matrix = component.matrix();
        Ok(norad::Component::new(
            ufo_name("component base glyph", component.base_glyph_name())?,
            norad::AffineTransform {
                x_scale: matrix.xx,
                xy_scale: matrix.xy,
                yx_scale: matrix.yx,
                y_scale: matrix.yy,
                x_offset: matrix.dx,
                y_offset: matrix.dy,
            },
            None,
        ))
    }

    fn convert_anchor(anchor: &shift_font::Anchor) -> FormatBackendResult<norad::Anchor> {
        let name = anchor
            .name()
            .map(|name| ufo_name("anchor", name))
            .transpose()?;
        Ok(norad::Anchor::new(anchor.x(), anchor.y(), name, None, None))
    }

    fn convert_guideline(guideline: &Guideline) -> FormatBackendResult<norad::Guideline> {
        let line = match (guideline.x(), guideline.y(), guideline.angle()) {
            (None, Some(y), None) => Line::Horizontal(y),
            (Some(x), None, None) => Line::Vertical(x),
            (Some(x), Some(y), Some(angle)) => Line::Angle {
                x,
                y,
                degrees: angle,
            },
            (Some(x), Some(y), None) => Line::Angle { x, y, degrees: 0.0 },
            _ => Line::Horizontal(0.0),
        };

        let name = guideline
            .name()
            .map(|name| ufo_name("guideline", name))
            .transpose()?;
        Ok(norad::Guideline::new(line, name, None, None))
    }

    fn convert_lib_value_to_plist(value: &LibValue) -> plist::Value {
        match value {
            LibValue::String(s) => plist::Value::String(s.clone()),
            LibValue::Integer(i) => plist::Value::Integer((*i).into()),
            LibValue::Float(f) => plist::Value::Real(*f),
            LibValue::Boolean(b) => plist::Value::Boolean(*b),
            LibValue::Array(arr) => {
                plist::Value::Array(arr.iter().map(Self::convert_lib_value_to_plist).collect())
            }
            LibValue::Dict(dict) => {
                let mut plist_dict = plist::Dictionary::new();
                for (k, v) in dict.iter() {
                    plist_dict.insert(k.clone(), Self::convert_lib_value_to_plist(v));
                }
                plist::Value::Dictionary(plist_dict)
            }
            LibValue::Data(d) => plist::Value::Data(d.clone()),
        }
    }

    fn convert_lib(lib: &LibData) -> plist::Dictionary {
        let mut dict = plist::Dictionary::new();
        for (k, v) in lib.iter() {
            dict.insert(k.clone(), Self::convert_lib_value_to_plist(v));
        }
        dict
    }

    fn convert_glyph(glyph: &Glyph, layer: &GlyphLayer) -> FormatBackendResult<NoradGlyph> {
        // NoradGlyph::new panics on invalid names, so validate first.
        let name = ufo_name("glyph", glyph.name())?;
        let mut norad_glyph = NoradGlyph::new(name.as_str());

        norad_glyph.width = layer.width();
        norad_glyph.height = layer.height().unwrap_or(0.0);

        for codepoint in glyph.unicodes() {
            if let Some(c) = char::from_u32(*codepoint) {
                norad_glyph.codepoints.insert(c);
            }
        }

        for contour in layer.contours_iter() {
            if contour.is_empty() {
                continue;
            }
            norad_glyph.contours.push(Self::convert_contour(contour));
        }

        for component in layer.components_iter() {
            norad_glyph
                .components
                .push(Self::convert_component(component)?);
        }

        for anchor in layer.anchors_iter() {
            norad_glyph.anchors.push(Self::convert_anchor(anchor)?);
        }

        for guideline in layer.guidelines() {
            norad_glyph
                .guidelines
                .push(Self::convert_guideline(guideline)?);
        }

        if !layer.lib().is_empty() {
            norad_glyph.lib = Self::convert_lib(layer.lib());
        }

        Ok(norad_glyph)
    }
}

impl Default for UfoWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl UfoWriter {
    pub fn save_view(&self, font: &impl FontView, path: &str) -> FormatBackendResult<()> {
        let norad_font = Self::build_norad_font(font)?;
        Self::write_atomic(&norad_font, Path::new(path))
    }

    fn build_norad_font(font: &impl FontView) -> FormatBackendResult<NoradFont> {
        let mut norad_font = NoradFont::new();

        norad_font.font_info.family_name = font.metadata().family_name.clone();
        norad_font.font_info.style_name = font.metadata().style_name.clone();
        norad_font.font_info.version_major = font.metadata().version_major;
        norad_font.font_info.version_minor = font.metadata().version_minor.map(|v| v as u32);
        norad_font.font_info.copyright = font.metadata().copyright.clone();
        norad_font.font_info.trademark = font.metadata().trademark.clone();
        norad_font.font_info.open_type_name_designer = font.metadata().designer.clone();
        norad_font.font_info.open_type_name_designer_url = font.metadata().designer_url.clone();
        norad_font.font_info.open_type_name_manufacturer = font.metadata().manufacturer.clone();
        norad_font.font_info.open_type_name_manufacturer_url =
            font.metadata().manufacturer_url.clone();
        norad_font.font_info.open_type_name_license = font.metadata().license.clone();
        norad_font.font_info.open_type_name_license_url = font.metadata().license_url.clone();
        norad_font.font_info.open_type_name_description = font.metadata().description.clone();
        norad_font.font_info.note = font.metadata().note.clone();

        norad_font.font_info.units_per_em = Some((font.metrics().units_per_em as u32).into());
        norad_font.font_info.ascender = Some(font.metrics().ascender);
        norad_font.font_info.descender = Some(font.metrics().descender);
        norad_font.font_info.cap_height = font.metrics().cap_height;
        norad_font.font_info.x_height = font.metrics().x_height;
        norad_font.font_info.italic_angle = font.metrics().italic_angle;

        let groups = font
            .kerning()
            .groups1()
            .iter()
            .chain(font.kerning().groups2());
        for (group_name, members) in groups {
            norad_font.groups.insert(
                ufo_name("kerning group", group_name)?,
                members
                    .iter()
                    .map(|n| ufo_name("kerning group member", n))
                    .collect::<FormatBackendResult<_>>()?,
            );
        }

        for pair in font.kerning().pairs() {
            let first = match &pair.first {
                KerningSide::Glyph(g) => ufo_name("kerning glyph", g)?,
                KerningSide::Group(g) => ufo_name("kerning group", g)?,
            };
            let second = match &pair.second {
                KerningSide::Glyph(g) => ufo_name("kerning glyph", g)?,
                KerningSide::Group(g) => ufo_name("kerning group", g)?,
            };

            norad_font
                .kerning
                .entry(first)
                .or_default()
                .insert(second, pair.value);
        }

        for guideline in font.guidelines() {
            norad_font
                .guidelines_mut()
                .push(Self::convert_guideline(guideline)?);
        }

        if !font.lib().is_empty() {
            norad_font.lib = Self::convert_lib(font.lib());
        }

        let default_source_id = font.default_source_id();
        let default_layer = norad_font.layers.default_layer_mut();

        for glyph in font.glyphs() {
            let Some(ref source_id) = default_source_id else {
                continue;
            };
            if let Some(layer_data) = glyph.layer_for_source(source_id.clone()) {
                let norad_glyph = Self::convert_glyph(glyph, layer_data)?;
                default_layer.insert_glyph(norad_glyph);
            }
        }

        for source in font.sources() {
            if Some(source.id()) == default_source_id {
                continue;
            }

            let norad_layer = norad_font
                .layers
                .new_layer(source.name())
                .map_err(|e| FormatBackendError::Ufo(e.to_string()))?;

            for glyph in font.glyphs() {
                if let Some(layer_data) = glyph.layer_for_source(source.id()) {
                    let norad_glyph = Self::convert_glyph(glyph, layer_data)?;
                    norad_layer.insert_glyph(norad_glyph);
                }
            }
        }

        if let Some(fea_source) = font.features().fea_source() {
            norad_font.features = fea_source.to_string();
        }

        Ok(norad_font)
    }

    /// Writes the UFO without ever destroying the existing target: the new
    /// UFO is fully staged in a temp sibling directory, the old UFO is moved
    /// aside, the staged one is swapped in, and only then is the old copy
    /// dropped. If the swap fails the old UFO is restored.
    fn write_atomic(norad_font: &NoradFont, target: &Path) -> FormatBackendResult<()> {
        let file_name = target.file_name().ok_or_else(|| {
            FormatBackendError::Ufo(format!("invalid UFO path '{}'", target.display()))
        })?;
        let parent = match target.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent,
            _ => Path::new("."),
        };
        std::fs::create_dir_all(parent)
            .map_err(|e| io_error("create parent directory for", target, e))?;

        // Staged in the target's parent so the swap is a same-filesystem rename.
        let staging = tempfile::Builder::new()
            .prefix(".shift-ufo-staging-")
            .tempdir_in(parent)
            .map_err(|e| io_error("create staging directory for", target, e))?;
        let staged_ufo = staging.path().join(file_name);
        norad_font
            .save(&staged_ufo)
            .map_err(|e| FormatBackendError::Ufo(e.to_string()))?;
        sync_tree(&staged_ufo).map_err(|e| io_error("sync staged UFO at", &staged_ufo, e))?;

        if target.exists() {
            let backup = staging.path().join("previous");
            std::fs::rename(target, &backup)
                .map_err(|e| io_error("move aside existing UFO at", target, e))?;

            if let Err(error) = std::fs::rename(&staged_ufo, target) {
                if std::fs::rename(&backup, target).is_err() {
                    // Keep the staging directory alive so the original UFO survives.
                    let staging_path = staging.keep();
                    return Err(FormatBackendError::Ufo(format!(
                        "failed to move new UFO into place at '{}': {error}; the original UFO was preserved at '{}'",
                        target.display(),
                        staging_path.join("previous").display(),
                    )));
                }
                return Err(io_error("move new UFO into place at", target, error));
            }
        } else {
            std::fs::rename(&staged_ufo, target)
                .map_err(|e| io_error("move new UFO into place at", target, e))?;
        }

        sync_parent(target).map_err(|e| io_error("sync parent directory of", target, e))?;
        Ok(())
    }
}

impl FontWriter for UfoWriter {
    fn save(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        self.save_view(font, path)
    }
}
