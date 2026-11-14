//! Fuzzes the designspace reader and writer: the input is a designspace
//! document whose sources may name `Light.ufo` and `Bold.ufo`.

#![no_main]

use libfuzzer_sys::fuzz_target;
use shift_fuzz::designspace_fixed_point;

fuzz_target!(|input: &[u8]| {
    let outcome = designspace_fixed_point(input);
    assert!(!outcome.is_broken(), "{outcome:?}");
});
