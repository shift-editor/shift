#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StoreKind {
    Document,
    Working,
}

pub struct ShiftStore {
    pub(crate) conn: rusqlite::Connection,
    pub(crate) path: Option<std::path::PathBuf>,
    pub(crate) kind: StoreKind,
}

impl ShiftStore {
    pub(crate) fn tracks_workspace(&self) -> bool {
        self.kind == StoreKind::Working
    }
}
