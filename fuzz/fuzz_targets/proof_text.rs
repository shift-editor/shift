#![no_main]

use libfuzzer_sys::fuzz_target;
use shift_font::ProofText;

fuzz_target!(|text: &str| {
    if let Ok(proof) = ProofText::parse(text) {
        // What parses formats back to text that parses to the same items.
        let items = proof.clone().into_items();
        let again = ProofText::parse(&proof.to_string()).expect("formatted proof text parses");
        assert_eq!(again.into_items(), items);
    }
});
