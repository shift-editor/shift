//! Store enums persisted as their names.

/// Implements [`rusqlite::ToSql`] and [`rusqlite::types::FromSql`] for enums
/// declared with `shift_font::string_enum!`, storing each value as its name.
macro_rules! sql_text {
    ($($name:ty),+ $(,)?) => {$(
        impl rusqlite::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(
                value: rusqlite::types::ValueRef<'_>,
            ) -> rusqlite::types::FromSqlResult<Self> {
                value
                    .as_str()?
                    .parse()
                    .map_err(|error| rusqlite::types::FromSqlError::Other(Box::new(error)))
            }
        }
    )+};
}

pub(crate) use sql_text;

#[cfg(test)]
mod tests {
    use crate::SourceKind;

    #[test]
    fn enums_round_trip_through_sqlite_as_their_names() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();

        let stored: String = conn
            .query_row("SELECT ?1", [SourceKind::Layer], |row| row.get(0))
            .unwrap();
        let read: SourceKind = conn
            .query_row("SELECT 'master'", [], |row| row.get(0))
            .unwrap();
        let unknown = conn.query_row("SELECT 'brace'", [], |row| row.get::<_, SourceKind>(0));

        assert_eq!(stored, "layer");
        assert_eq!(read, SourceKind::Master);
        assert!(matches!(
            unknown,
            Err(rusqlite::Error::FromSqlConversionFailure(0, _, _))
        ));
    }
}
