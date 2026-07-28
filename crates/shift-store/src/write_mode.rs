#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WriteMode {
    Insert,
    Upsert,
}
