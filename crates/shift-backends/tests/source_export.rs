mod source_export {
    /// A fixture step that fails with a reason instead of panicking, so a test
    /// decides how its failure reads.
    type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

    mod properties;
    mod round_trip;
    mod summary;
}
