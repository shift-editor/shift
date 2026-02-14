use crate::traits::FontReader;
use norad::{Font as NoradFont, Line};
use shift_ir::{
    Anchor, Component, Contour, FeatureData, Font, Glyph, GlyphLayer, Guideline, KerningData,
    KerningPair, KerningSide, Layer, LibData, LibValue, PointType, Transform,
};
use std::collections::HashMap;
use std::path::Path;

pub struct UfoReader;

impl UfoReader {
    pub fn new() -> Self {
        Self
    }

    fn convert_point_type(typ: &norad::PointType) -> PointType {
        match typ {
            norad::PointType::Move => PointType::OnCurve,
            norad::PointType::Line => PointType::OnCurve,
            norad::PointType::Curve => PointType::OnCurve,
            norad::PointType::QCurve => PointType::QCurve,
            norad::PointType::OffCurve => PointType::OffCurve,
        }
    }

    fn convert_contour(contour: &norad::Contour) -> Contour {
        let mut shift_contour = Contour::new();
        let is_closed = contour.is_closed();

        for point in &contour.points {
            let point_type = Self::convert_point_type(&point.typ);
            shift_contour.add_point(point.x, point.y, point_type, point.smooth);
        }

        if is_closed {
            shift_contour.close();
        }

        shift_contour
    }

    fn convert_component(component: &norad::Component) -> Component {
        let matrix = Transform {
            xx: component.transform.x_scale,
            xy: component.transform.xy_scale,
            yx: component.transform.yx_scale,
            yy: component.transform.y_scale,
            dx: component.transform.x_offset,
            dy: component.transform.y_offset,
        };
        Component::with_matrix(component.base.to_string(), &matrix)
    }

    fn convert_anchor(anchor: &norad::Anchor) -> Anchor {
        Anchor::new(
            anchor.name.as_ref().map(|name| name.to_string()),
            anchor.x,
            anchor.y,
        )
    }

    fn convert_guideline(guideline: &norad::Guideline) -> Guideline {
        match guideline.line {
            Line::Horizontal(y) => Guideline::horizontal(y),
            Line::Vertical(x) => Guideline::vertical(x),
            Line::Angle { x, y, degrees } => Guideline::angled(x, y, degrees),
        }
    }

    fn convert_plist_to_lib_value(plist: &plist::Value) -> LibValue {
        match plist {
            plist::Value::String(s) => LibValue::String(s.clone()),
            plist::Value::Integer(i) => LibValue::Integer(i.as_signed().unwrap_or(0)),
            plist::Value::Real(f) => LibValue::Float(*f),
            plist::Value::Boolean(b) => LibValue::Boolean(*b),
            plist::Value::Array(arr) => {
                LibValue::Array(arr.iter().map(Self::convert_plist_to_lib_value).collect())
            }
            plist::Value::Dictionary(dict) => {
                let mut map = HashMap::new();
                for (k, v) in dict.iter() {
                    map.insert(k.clone(), Self::convert_plist_to_lib_value(v));
                }
                LibValue::Dict(map)
            }
            plist::Value::Data(d) => LibValue::Data(d.clone()),
            _ => LibValue::String(String::new()),
        }
    }

    fn convert_lib(lib: &plist::Dictionary) -> LibData {
        let mut data = HashMap::new();
        for (k, v) in lib.iter() {
            data.insert(k.clone(), Self::convert_plist_to_lib_value(v));
        }
        LibData::from_map(data)
    }

    fn convert_glyph_layer(
        norad_glyph: &norad::Glyph,
        layer_id: shift_ir::LayerId,
    ) -> (Glyph, GlyphLayer) {
        let mut glyph_layer = GlyphLayer::with_width(norad_glyph.width);
        if norad_glyph.height != 0.0 {
            glyph_layer.set_height(Some(norad_glyph.height));
        }

        for contour in &norad_glyph.contours {
            glyph_layer.add_contour(Self::convert_contour(contour));
        }

        for component in &norad_glyph.components {
            glyph_layer.add_component(Self::convert_component(component));
        }

        for anchor in &norad_glyph.anchors {
            glyph_layer.add_anchor(Self::convert_anchor(anchor));
        }

        for guideline in &norad_glyph.guidelines {
            glyph_layer.add_guideline(Self::convert_guideline(guideline));
        }

        if !norad_glyph.lib.is_empty() {
            *glyph_layer.lib_mut() = Self::convert_lib(&norad_glyph.lib);
        }

        let mut glyph = Glyph::new(norad_glyph.name().to_string());
        for codepoint in norad_glyph.codepoints.iter() {
            glyph.add_unicode(u32::from(codepoint));
        }

        if !norad_glyph.lib.is_empty() {
            *glyph.lib_mut() = Self::convert_lib(&norad_glyph.lib);
        }

        glyph.set_layer(layer_id, glyph_layer);
        (glyph, GlyphLayer::new())
    }

    fn convert_kerning(norad_font: &NoradFont) -> KerningData {
        let mut kerning = KerningData::new();

        for (key, members) in norad_font.groups.iter() {
            let key_str = key.as_str();
            if key_str.starts_with("public.kern1.") {
                kerning.set_group1(
                    key_str.to_string(),
                    members.iter().map(|n| n.to_string()).collect(),
                );
            } else if key_str.starts_with("public.kern2.") {
                kerning.set_group2(
                    key_str.to_string(),
                    members.iter().map(|n| n.to_string()).collect(),
                );
            }
        }

        for (first, seconds) in norad_font.kerning.iter() {
            let first_str = first.as_str();
            let first_side = if first_str.starts_with("public.kern1.") {
                KerningSide::Group(first_str.to_string())
            } else {
                KerningSide::Glyph(first_str.to_string())
            };

            for (second, value) in seconds.iter() {
                let second_str = second.as_str();
                let second_side = if second_str.starts_with("public.kern2.") {
                    KerningSide::Group(second_str.to_string())
                } else {
                    KerningSide::Glyph(second_str.to_string())
                };

                kerning.add_pair(KerningPair::new(first_side.clone(), second_side, *value));
            }
        }

        kerning
    }

    fn load_features(ufo_path: &Path) -> FeatureData {
        let fea_path = ufo_path.join("features.fea");
        if fea_path.exists() {
            match std::fs::read_to_string(&fea_path) {
                Ok(content) => FeatureData::from_fea(content),
                Err(_) => FeatureData::new(),
            }
        } else {
            FeatureData::new()
        }
    }
}

impl Default for UfoReader {
    fn default() -> Self {
        Self::new()
    }
}

impl FontReader for UfoReader {
    fn load(&self, path: &str) -> Result<Font, String> {
        let norad_font = NoradFont::load(path).map_err(|e| e.to_string())?;
        let ufo_path = Path::new(path);

        let mut font = Font::new();
        let default_layer_id = font.default_layer_id();

        if let Some(family) = &norad_font.font_info.family_name {
            font.metadata_mut().family_name = Some(family.clone());
        }
        if let Some(style) = &norad_font.font_info.style_name {
            font.metadata_mut().style_name = Some(style.clone());
        }
        font.metadata_mut().version_major = norad_font.font_info.version_major;
        font.metadata_mut().version_minor = norad_font.font_info.version_minor.map(|v| v as i32);
        font.metadata_mut().copyright = norad_font.font_info.copyright.clone();
        font.metadata_mut().trademark = norad_font.font_info.trademark.clone();
        font.metadata_mut().designer = norad_font.font_info.open_type_name_designer.clone();
        font.metadata_mut().designer_url = norad_font.font_info.open_type_name_designer_url.clone();
        font.metadata_mut().manufacturer = norad_font.font_info.open_type_name_manufacturer.clone();
        font.metadata_mut().manufacturer_url =
            norad_font.font_info.open_type_name_manufacturer_url.clone();
        font.metadata_mut().license = norad_font.font_info.open_type_name_license.clone();
        font.metadata_mut().license_url = norad_font.font_info.open_type_name_license_url.clone();
        font.metadata_mut().description = norad_font.font_info.open_type_name_description.clone();
        font.metadata_mut().note = norad_font.font_info.note.clone();

        let upm = norad_font
            .font_info
            .units_per_em
            .map(|n| *n)
            .unwrap_or(1000.0);
        font.metrics_mut().units_per_em = upm;
        font.metrics_mut().ascender = norad_font.font_info.ascender.unwrap_or(800.0);
        font.metrics_mut().descender = norad_font.font_info.descender.unwrap_or(-200.0);
        font.metrics_mut().cap_height = norad_font.font_info.cap_height;
        font.metrics_mut().x_height = norad_font.font_info.x_height;
        font.metrics_mut().italic_angle = norad_font.font_info.italic_angle;

        for layer in norad_font.layers.iter() {
            let layer_id = if layer.name().as_str() == "public.default" {
                default_layer_id
            } else {
                let new_layer = Layer::new(layer.name().to_string());
                font.add_layer(new_layer)
            };

            for norad_glyph in layer.iter() {
                let (glyph, _) = Self::convert_glyph_layer(norad_glyph, layer_id);

                if let Some(existing) = font.glyph_mut(glyph.name()) {
                    if let Some(layer_data) = glyph.layer(layer_id) {
                        existing.set_layer(layer_id, layer_data.clone());
                    }
                } else {
                    font.insert_glyph(glyph);
                }
            }
        }

        *font.kerning_mut() = Self::convert_kerning(&norad_font);
        *font.features_mut() = Self::load_features(ufo_path);

        for guideline in norad_font.guidelines() {
            font.add_guideline(Self::convert_guideline(guideline));
        }

        if !norad_font.lib.is_empty() {
            *font.lib_mut() = Self::convert_lib(&norad_font.lib);
        }

        Ok(font)
    }
}
