use std::collections::HashMap;

use norad::Font as NoradFont;

use crate::contour::Contour;
use crate::font::{Font, FontMetadata, Metrics};
use crate::font_loader::FontAdaptor;
use crate::glyph::Glyph;
use crate::point::PointType;

pub fn load_ufo(path: String) -> NoradFont {
    NoradFont::load(path).expect("Failed to load UFO")
}

pub fn get_contours(font: NoradFont, name: &str) -> Vec<Contour> {
    let glyph = font.get_glyph(name).unwrap();
    from_ufo_contours(&glyph.contours)
}

fn from_ufo_contours(contours: &Vec<norad::Contour>) -> Vec<Contour> {
    let mut shift_contours = Vec::<Contour>::new();
    for contour in contours {
        let mut c = Contour::new();
        let mut closed = true;
        contour.points.iter().for_each(|p| match p.typ {
            norad::PointType::Move => {
                c.add_point(p.x, p.y, PointType::OnCurve, p.smooth);
                closed = false;
            }

            norad::PointType::Line => {
                c.add_point(p.x, p.y, PointType::OnCurve, p.smooth);
            }

            norad::PointType::Curve => {
                c.add_point(p.x, p.y, PointType::OnCurve, p.smooth);
            }

            norad::PointType::QCurve => {
                c.add_point(p.x, p.y, PointType::OnCurve, p.smooth);
            }

            norad::PointType::OffCurve => {
                c.add_point(p.x, p.y, PointType::OffCurve, p.smooth);
            }
        });

        if closed {
            c.close();
        }

        shift_contours.push(c);
    }

    shift_contours
}

pub struct UfoFontAdaptor;

impl From<NoradFont> for Font {
    fn from(font: NoradFont) -> Self {
        let mut glyphs = HashMap::new();

        for layer in font.layers.iter() {
            for glyph in layer.iter() {
                let contours = from_ufo_contours(&glyph.contours);
                let name = glyph.name().to_string();
                if let Some(codepoint) = glyph.codepoints.iter().next() {
                    let unicode = codepoint.into();
                    let g = Glyph::from_contours(name, unicode, glyph.width, contours);
                    glyphs.insert(unicode, g);
                }
            }
        }

        let metadata = FontMetadata {
            family: font.font_info.family_name.unwrap_or_default(),
            style_name: font.font_info.style_name.unwrap_or_default(),
            version: font.font_info.version_major.unwrap_or_default(),
        };

        let metrics = Metrics {
            units_per_em: *font.font_info.units_per_em.unwrap_or(2048.into()),
            ascender: font.font_info.ascender.unwrap_or_default(),
            descender: font.font_info.descender.unwrap_or_default(),
            cap_height: font.font_info.cap_height.unwrap_or_default(),
            x_height: font.font_info.x_height.unwrap_or_default(),
        };

        Font::new(metadata, metrics, glyphs)
    }
}

impl FontAdaptor for UfoFontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String> {
        let font = load_ufo(path.to_string());
        Ok(font.into())
    }

    fn write_font(&self, _font: &Font, _path: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {}
