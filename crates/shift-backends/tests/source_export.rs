#![expect(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "font builders and export helpers fail loudly on bad input"
)]

mod source_export {
    mod properties;
    mod round_trip;
    mod summary;
}
