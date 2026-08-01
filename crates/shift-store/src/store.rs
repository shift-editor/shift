pub struct ShiftStore {
    pub(crate) conn: rusqlite::Connection,
    pub(crate) path: Option<std::path::PathBuf>,
}
