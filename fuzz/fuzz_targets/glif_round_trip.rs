//! Fuzzes the UFO reader and writer: the input replaces glyph `A`'s `.glif`
//! file in an otherwise valid UFO.

#![no_main]

use libfuzzer_sys::fuzz_target;
use shift_backends::ExportFormat;
use shift_fuzz::{assert_export_is_a_fixed_point, write_master_ufo};

fuzz_target!(|glif: &[u8]| {
    let directory = tempfile::tempdir().expect("temporary directory");
    let path = directory.path().join("Fuzz.ufo");
    write_master_ufo(&path, "Regular");
    std::fs::write(path.join("glyphs").join("A_.glif"), glif).expect("fuzz input writes");

    assert_export_is_a_fixed_point(&path, ExportFormat::Ufo);
});
