use read_fonts::{FontRef, TableProvider};
use shift_compile::{KernPair, compile_shaper_font};

#[test]
fn compiles_minimal_shaper_font() {
    let glyphs = vec![".notdef", "A", "V"];
    let unicodes = vec![('A', 1), ('V', 2)];
    let bytes = compile_shaper_font(&glyphs, &unicodes, &[]).expect("compile failed");

    let font = FontRef::new(&bytes).expect("not valid sfnt");

    assert!(font.cmap().is_ok(), "missing cmap");
    assert!(font.head().is_ok(), "missing head");
    assert!(font.maxp().is_ok(), "missing maxp");
    assert!(font.hhea().is_ok(), "missing hhea");
    assert!(font.hmtx().is_ok(), "missing hmtx");
}

#[test]
fn harfrust_applies_compiled_kern() {
    let glyphs = vec![".notdef", "A", "V"];
    let unicodes = vec![('A', 1), ('V', 2)];
    let kern = vec![KernPair {
        left: "A".to_string(),
        right: "V".to_string(),
        adjustment: -50,
    }];
    let bytes = compile_shaper_font(&glyphs, &unicodes, &kern).expect("compile failed");

    let font = harfrust::FontRef::new(&bytes).expect("harfrust rejected the font");
    let shaper_data = harfrust::ShaperData::new(&font);
    let shaper = shaper_data.shaper(&font).build();

    let mut buffer = harfrust::UnicodeBuffer::new();
    buffer.push_str("AV");
    buffer.guess_segment_properties();
    let output = shaper.shape(buffer, &[]);

    let positions = output.glyph_positions();
    assert_eq!(positions.len(), 2, "expected 2 positioned glyphs");
    assert!(
        positions[0].x_advance < positions[1].x_advance,
        "expected A's advance (with kern) < V's (no kern). Got A={} V={}",
        positions[0].x_advance,
        positions[1].x_advance,
    );
}

#[test]
fn kern_pair_appears_in_gpos() {
    let glyphs = vec![".notdef", "A", "V"];
    let unicodes = vec![('A', 1), ('V', 2)];
    let kern = vec![KernPair {
        left: "A".to_string(),
        right: "V".to_string(),
        adjustment: -50,
    }];
    let bytes = compile_shaper_font(&glyphs, &unicodes, &kern).expect("compile failed");

    let font = FontRef::new(&bytes).expect("not valid sfnt");
    let gpos = font.gpos().expect("no GPOS table");
    let lookup_list = gpos.lookup_list().expect("no lookup list");
    assert!(
        lookup_list.lookup_count() > 0,
        "GPOS has zero lookups — kern pair did not survive",
    );
}
