//! Fuzzes the UFO reader and writer: the input replaces glyph `A`'s `.glif`
//! file in an otherwise valid UFO.

#![no_main]

use libfuzzer_sys::fuzz_target;
use shift_fuzz::glif_fixed_point;

fuzz_target!(|input: &[u8]| {
    let outcome = glif_fixed_point(input);
    assert!(!outcome.is_broken(), "{outcome:?}");
});
