//! Pack round trips: a value written to numbers and read back is the same
//! value, with the names it uses carried beside it as the engine sends them.

#![cfg(feature = "pack")]

use pack::{CarriedNames, Pack, Reader, Writer};
use proptest::prelude::*;
use shift_font::{GlyphId, GlyphLayerRecord, GlyphName, GlyphRecord, LayerId, Ligature, SourceId};

/// Any text, including empty, unicode and text that repeats across fields.
fn text() -> impl Strategy<Value = String> {
    prop_oneof![
        Just(String::new()),
        Just("a".to_string()),
        "[a-z.]{1,8}",
        "\\PC{0,12}",
    ]
}

fn ligature() -> impl Strategy<Value = Option<Ligature>> {
    prop_oneof![
        Just(None),
        Just(Some(Ligature::Explicit)),
        Just(Some(Ligature::Subcategory)),
    ]
}

fn layer() -> impl Strategy<Value = GlyphLayerRecord> {
    (text(), text()).prop_map(|(id, source_id)| GlyphLayerRecord {
        id: LayerId::from_raw(id),
        source_id: SourceId::from_raw(source_id),
    })
}

fn record() -> impl Strategy<Value = GlyphRecord> {
    (
        text(),
        text(),
        prop::collection::vec(0..=0x10_FFFFu32, 0..4),
        prop::collection::vec(text(), 0..4),
        prop::collection::vec(layer(), 0..4),
        any::<bool>(),
        any::<bool>(),
        ligature(),
    )
        .prop_map(
            |(id, name, unicodes, bases, layers, mark, nonspacing_mark, ligature)| GlyphRecord {
                id: GlyphId::from_raw(id),
                name: GlyphName::from_raw(name),
                unicodes,
                component_base_glyph_ids: bases.into_iter().map(GlyphId::from_raw).collect(),
                layers,
                mark,
                nonspacing_mark,
                ligature,
            },
        )
}

/// Writes `value` as one side of a call does and reads it as the other.
fn round_trip<T: Pack>(value: &T) -> T {
    let mut sent = CarriedNames::default();
    let mut writer = Writer::new(&mut sent);
    value.write(&mut writer);
    let mut packed = writer.finish();
    let received = CarriedNames::received(&sent.into_blob());
    T::read(&mut Reader::new(
        &packed.numbers,
        &mut packed.blobs,
        &received,
    ))
}

proptest! {
    #[test]
    fn a_glyph_record_reads_back_as_written(records in prop::collection::vec(record(), 0..4)) {
        prop_assert_eq!(round_trip(&records), records);
    }
}
