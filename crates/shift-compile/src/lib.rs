use fea_rs::{
    GlyphMap,
    compile::{Compiler, FeatureBuilder, FeatureProvider, NopVariationInfo, PendingLookup},
};
use fontdrasil::types::GlyphName;
use std::path::Path;
use std::sync::Arc;

use write_fonts::{
    FontBuilder,
    tables::{
        cmap::Cmap,
        gpos::builders::{PairPosBuilder, ValueRecordBuilder},
        head::Head,
        hhea::Hhea,
        hmtx::{Hmtx, LongMetric},
        layout::LookupFlag,
        maxp::Maxp,
    },
    types::{GlyphId, GlyphId16, Tag},
};

pub struct KernPair {
    pub left: String,
    pub right: String,
    pub adjustment: i16,
}

struct Kerning {
    pairs: Vec<(GlyphId16, GlyphId16, i16)>,
}

impl FeatureProvider for Kerning {
    fn add_features(&self, builder: &mut FeatureBuilder) {
        if self.pairs.is_empty() {
            return;
        }

        let mut pair_pos = PairPosBuilder::default();
        for (left, right, adj) in &self.pairs {
            pair_pos.insert_pair(
                *left,
                ValueRecordBuilder::new().with_x_advance(*adj),
                *right,
                ValueRecordBuilder::new(),
            );
        }

        let lookup_id = builder.add_lookup(PendingLookup::new(
            vec![pair_pos],
            LookupFlag::empty(),
            None,
        ));
        builder.add_to_default_language_systems(Tag::new(b"kern"), &[lookup_id]);
    }
}

fn glyph_id(glyphs: &[&str], name: &str) -> Result<GlyphId16, String> {
    glyphs
        .iter()
        .position(|g| *g == name)
        .map(|i| GlyphId16::new(i as u16))
        .ok_or_else(|| format!("glyph '{name}' not in glyph order"))
}

pub fn compile_shaper_font(
    glyphs: &[&str],
    unicodes: &[(char, u16)],
    kern: &[KernPair],
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let gm: GlyphMap = glyphs
        .iter()
        .map(|s| GlyphName::from(s.to_string()))
        .collect();

    let pairs = kern
        .iter()
        .map(|kp| {
            Ok::<_, Box<dyn std::error::Error>>((
                glyph_id(glyphs, &kp.left)?,
                glyph_id(glyphs, &kp.right)?,
                kp.adjustment,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let kerning = Kerning { pairs };

    let compiled = Compiler::<_, NopVariationInfo>::new("", &gm)
        .with_resolver(|_: &Path| Ok(Arc::from("")))
        .with_feature_writer(&kerning)
        .compile()?;

    let mut fb: FontBuilder = compiled.to_font_builder()?;

    let num_glyphs: u16 = glyphs.len().try_into()?;

    fb.add_table(&Maxp::new(num_glyphs))?;

    let cmap = Cmap::from_mappings(
        unicodes
            .iter()
            .map(|(c, gid)| (*c, GlyphId::new(*gid as u32))),
    )?;
    fb.add_table(&cmap)?;

    fb.add_table(&Head::default())?;

    let hhea = Hhea::new(
        800.into(),
        (-200).into(),
        0.into(),
        1000.into(),
        0.into(),
        0.into(),
        1000.into(),
        1,
        0,
        0,
        num_glyphs,
    );
    fb.add_table(&hhea)?;

    let h_metrics = (0..num_glyphs).map(|_| LongMetric::new(500, 0)).collect();
    fb.add_table(&Hmtx::new(h_metrics, Vec::new()))?;

    Ok(fb.build())
}
