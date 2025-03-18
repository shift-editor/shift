use std::collections::HashMap;

use norad::Font as NoradFont;

use crate::contour::{Contour, ContourPoint, PointType};
use crate::font::{Font, FontMetadata, Metrics};
use crate::font_service::FontAdaptor;
use crate::glyph::Glyph;

pub fn load_ufo(path: String) -> NoradFont {
    let font = NoradFont::load(path).expect("Failed to load UFO");
    font
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
                c.add_point(ContourPoint::new(p.x, p.y, PointType::OnCurve, false));
                closed = false;
            }

            norad::PointType::Line => {
                c.add_point(ContourPoint::new(p.x, p.y, PointType::OnCurve, false));
            }

            norad::PointType::Curve => {
                c.add_point(ContourPoint::new(p.x, p.y, PointType::OnCurve, false));
            }

            norad::PointType::OffCurve => {
                c.add_point(ContourPoint::new(p.x, p.y, PointType::OffCurve, false));
            }

            _ => {}
        });

        if closed {
            c.close();
        }

        shift_contours.push(c);
    }

    return shift_contours;
}

pub struct UfoFontAdaptor;

impl From<NoradFont> for Font {
    fn from(font: NoradFont) -> Self {
        let mut glyphs = HashMap::<char, Glyph>::new();

        for layer in font.layers.iter() {
            for glyph in layer.iter() {
                let contours = from_ufo_contours(&glyph.contours);
                let name = glyph.name().to_string();
                if let Some(codepoint) = glyph.codepoints.iter().next() {
                    let g = Glyph::new(name, codepoint, contours, glyph.width);
                    glyphs.insert(codepoint, g);
                }
            }
        }

        Font {
            metadata: FontMetadata {
                family: font.font_info.family_name.unwrap(),
                style_name: font.font_info.style_name.unwrap(),
                version: font.font_info.version_major.unwrap(),
            },
            metrics: Metrics {
                units_per_em: *font.font_info.units_per_em.unwrap(),
                ascender: font.font_info.ascender.unwrap(),
                descender: font.font_info.descender.unwrap(),
                cap_height: font.font_info.cap_height.unwrap(),
                x_height: font.font_info.x_height.unwrap(),
            },
            glyphs,
        }
    }
}

impl FontAdaptor for UfoFontAdaptor {
    fn extension(&self) -> &str {
        "ufo"
    }

    fn read_font(&self, path: &str) -> Result<Font, String> {
        let font = load_ufo(path.to_string());
        Ok(font.into())
    }

    fn write_font(&self, font: &Font, path: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use norad::{Contour, ContourPoint, Glyph};

    fn create_test_ufo() -> NoradFont {
        let mut font = NoradFont::new();

        let mut a_glyph = Glyph::new("A");
        a_glyph.width = 1628.0;
        a_glyph.codepoints.insert('A');

        // First contour (outer shape of A)
        let mut contour1 = Vec::<ContourPoint>::new();
        contour1.push(ContourPoint::new(
            46.0,
            0.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            498.0,
            0.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            663.0,
            578.0,
            norad::PointType::Line,
            true,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            735.0,
            829.0,
            norad::PointType::OffCurve,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            789.0,
            1104.0,
            norad::PointType::OffCurve,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            845.0,
            1371.0,
            norad::PointType::Curve,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            753.0,
            1371.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            812.0,
            1104.0,
            norad::PointType::OffCurve,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            876.0,
            829.0,
            norad::PointType::OffCurve,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            951.0,
            578.0,
            norad::PointType::Curve,
            true,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            1124.0,
            0.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            1582.0,
            0.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            1081.0,
            1490.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour1.push(ContourPoint::new(
            529.0,
            1490.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));

        // Second contour (crossbar of A)
        let mut contour2 = Vec::<ContourPoint>::new();
        contour2.push(ContourPoint::new(
            404.0,
            286.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour2.push(ContourPoint::new(
            1224.0,
            286.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour2.push(ContourPoint::new(
            1224.0,
            588.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));
        contour2.push(ContourPoint::new(
            404.0,
            588.0,
            norad::PointType::Line,
            false,
            None,
            None,
        ));

        // Create contours from points
        let mut contours = Vec::new();
        contours.push(Contour::new(contour1, None));
        contours.push(Contour::new(contour2, None));
        a_glyph.contours = contours;

        // Add the glyph to a layer
        let default_layer = font.layers.get_or_create_layer("public.default").unwrap();
        default_layer.insert_glyph(a_glyph);

        font
    }

    #[test]

    fn to_shift() {
        let font = create_test_ufo();
    }
}
