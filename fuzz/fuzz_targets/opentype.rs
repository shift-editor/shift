#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|bytes: &[u8]| {
    let path = shift_fuzz::scratch().join("input.ttf");
    shift_fuzz::write(&path, bytes);
    shift_fuzz::exercise(&path);
});
