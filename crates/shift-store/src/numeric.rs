//! Integer conversions between in-memory sizes and SQLite integers.

/// An in-memory index or length as a SQLite integer.
#[expect(
    clippy::cast_possible_wrap,
    reason = "indices and lengths are below isize::MAX, so they fit in i64"
)]
pub(crate) fn sql_int(value: usize) -> i64 {
    value as i64
}
