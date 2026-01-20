use crate::traits::FontWriter;
use norad::{Font as NoradFont, Glyph as NoradGlyph, Line, Name};
use shift_ir::{
    Contour, Font, Glyph, GlyphLayer, Guideline, KerningSide, LibData, LibValue, Point, PointType,
};
use std::path::Path;

pub struct UfoWriter;

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

    fn convert_component(component: &shift_ir::Component) -> norad::Component {
        let transform = component.transform();
        norad::Component::new(
            Name::new(component.base_glyph()).unwrap(),
            norad::AffineTransform {
                x_scale: transform.xx,
                xy_scale: transform.xy,
                yx_scale: transform.yx,
                y_scale: transform.yy,
                x_offset: transform.dx,
                y_offset: transform.dy,
            },
            None,
        )
    }

    fn convert_anchor(anchor: &shift_ir::Anchor) -> norad::Anchor {
        norad::Anchor::new(
            anchor.x(),
            anchor.y(),
            Some(Name::new(anchor.name()).unwrap()),
            None,
            None,
        )
    }

    fn convert_guideline(guideline: &Guideline) -> norad::Guideline {
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

        norad::Guideline::new(
            line,
            guideline.name().map(|n| Name::new(n).unwrap()),
            None,
            None,
        )
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

    fn convert_glyph(glyph: &Glyph, layer: &GlyphLayer) -> NoradGlyph {
        let mut norad_glyph = NoradGlyph::new(glyph.name());

        norad_glyph.width = layer.width();
        norad_glyph.height = layer.height().unwrap_or(0.0);

        for codepoint in glyph.unicodes() {
            if let Some(c) = char::from_u32(*codepoint) {
                norad_glyph.codepoints.insert(c);
            }
        }

        for contour in layer.contours_iter() {
            norad_glyph.contours.push(Self::convert_contour(contour));
        }

        for component in layer.components_iter() {
            norad_glyph
                .components
                .push(Self::convert_component(component));
        }

        for anchor in layer.anchors_iter() {
            norad_glyph.anchors.push(Self::convert_anchor(anchor));
        }

        for guideline in layer.guidelines() {
            norad_glyph
                .guidelines
                .push(Self::convert_guideline(guideline));
        }

        if !layer.lib().is_empty() {
            norad_glyph.lib = Self::convert_lib(layer.lib());
        }

        norad_glyph
    }
}

impl Default for UfoWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl FontWriter for UfoWriter {
    fn save(&self, font: &Font, path: &str) -> Result<(), String> {
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

        for (group_name, members) in font.kerning().groups1() {
            norad_font.groups.insert(
                Name::new(group_name).unwrap(),
                members.iter().map(|n| Name::new(n).unwrap()).collect(),
            );
        }

        for (group_name, members) in font.kerning().groups2() {
            norad_font.groups.insert(
                Name::new(group_name).unwrap(),
                members.iter().map(|n| Name::new(n).unwrap()).collect(),
            );
        }

        for pair in font.kerning().pairs() {
            let first = match &pair.first {
                KerningSide::Glyph(g) => Name::new(g).unwrap(),
                KerningSide::Group(g) => Name::new(g).unwrap(),
            };
            let second = match &pair.second {
                KerningSide::Glyph(g) => Name::new(g).unwrap(),
                KerningSide::Group(g) => Name::new(g).unwrap(),
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
                .push(Self::convert_guideline(guideline));
        }

        if !font.lib().is_empty() {
            norad_font.lib = Self::convert_lib(font.lib());
        }

        let default_layer_id = font.default_layer_id();
        let default_layer = norad_font.layers.default_layer_mut();

        for glyph in font.glyphs().values() {
            if let Some(layer_data) = glyph.layer(default_layer_id) {
                let norad_glyph = Self::convert_glyph(glyph, layer_data);
                default_layer.insert_glyph(norad_glyph);
            }
        }

        for (layer_id, layer) in font.layers() {
            if *layer_id == default_layer_id {
                continue;
            }

            let norad_layer = norad_font
                .layers
                .new_layer(layer.name())
                .map_err(|e| e.to_string())?;

            for glyph in font.glyphs().values() {
                if let Some(layer_data) = glyph.layer(*layer_id) {
                    let norad_glyph = Self::convert_glyph(glyph, layer_data);
                    norad_layer.insert_glyph(norad_glyph);
                }
            }
        }

        if let Some(fea_source) = font.features().fea_source() {
            std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
            let fea_path = Path::new(path).join("features.fea");
            std::fs::write(fea_path, fea_source).map_err(|e| e.to_string())?;
        }

        norad_font.save(path).map_err(|e| e.to_string())
    }
}
