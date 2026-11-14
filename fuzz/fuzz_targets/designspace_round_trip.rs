//! Fuzzes the designspace reader and writer: the input is a designspace
//! document whose sources may name `Light.ufo` and `Bold.ufo`.

#![no_main]

use libfuzzer_sys::fuzz_target;
use shift_backends::ExportFormat;
use shift_fuzz::{assert_export_is_a_fixed_point, write_master_ufo};

fuzz_target!(|document: &[u8]| {
    let directory = tempfile::tempdir().expect("temporary directory");
    write_master_ufo(&directory.path().join("Light.ufo"), "Light");
    write_master_ufo(&directory.path().join("Bold.ufo"), "Bold");
    let path = directory.path().join("Fuzz.designspace");
    std::fs::write(&path, document).expect("fuzz input writes");

    assert_export_is_a_fixed_point(&path, ExportFormat::Designspace);
});
