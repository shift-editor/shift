use norad::Font;

use crate::contour::{Contour, ContourPoint, PointType};

pub fn load_ufo(path: String) -> Font {
    let font = Font::load(path).expect("Failed to load UFO");
    font
}

pub fn get_contours(font: Font, name: &str) -> Vec<Contour> {
    let glyph = font.get_glyph(name).unwrap();
    from_ufo(&glyph.contours)
}

fn from_ufo(contours: &Vec<norad::Contour>) -> Vec<Contour> {
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

#[cfg(test)]
mod tests {
    use super::*;

    use norad::{Contour, ContourPoint, Glyph};

    fn create_test_ufo() -> Font {
        let mut font = Font::new();

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
