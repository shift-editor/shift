//! How the store spells shift-font values in its columns.
//!
//! Each codec both writes and reads its column, so a value's stored form is
//! written once.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use shift_font as font;

use crate::StoreError;

/// Declares a column newtype for a shift-font enum stored as one fixed name
/// per variant.
macro_rules! named_column {
    ($(#[$meta:meta])* $column:ident($value:ty) { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        pub(crate) struct $column(pub(crate) $value);

        impl ToSql for $column {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                let name = match self.0 {
                    $(<$value>::$variant => $text,)+
                };
                Ok(name.into())
            }
        }

        impl FromSql for $column {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                match value.as_str()? {
                    $($text => Ok(Self(<$value>::$variant)),)+
                    other => Err(FromSqlError::Other(
                        format!(concat!("unknown ", stringify!($column), " {:?}"), other).into(),
                    )),
                }
            }
        }
    };
}

named_column! {
    /// An axis role, in the `axes.role` column.
    AxisRoleColumn(font::AxisRole) {
        External => "external",
        Internal => "internal",
    }
}

named_column! {
    /// A metric kind, in the `metric_definitions.kind` column.
    MetricKindColumn(font::MetricKind) {
        Ascender => "ascender",
        CapHeight => "cap_height",
        XHeight => "x_height",
        Baseline => "baseline",
        Descender => "descender",
        Custom => "custom",
    }
}

/// A kerning group position, in the `kerning_groups.position` column.
pub(crate) struct KerningPositionColumn(pub(crate) font::KerningPosition);

impl KerningPositionColumn {
    const FIRST: i64 = 1;
    const SECOND: i64 = 2;
}

impl ToSql for KerningPositionColumn {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self.0 {
            font::KerningPosition::First => Self::FIRST,
            font::KerningPosition::Second => Self::SECOND,
        }
        .into())
    }
}

impl FromSql for KerningPositionColumn {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_i64()? {
            Self::FIRST => Ok(Self(font::KerningPosition::First)),
            Self::SECOND => Ok(Self(font::KerningPosition::Second)),
            other => Err(FromSqlError::OutOfRange(other)),
        }
    }
}

/// A kerning pair side, in a `*_kind` and `*_value` column pair.
pub(crate) struct KerningSideColumns<'a> {
    pub(crate) kind: &'static str,
    pub(crate) value: &'a str,
}

impl<'a> KerningSideColumns<'a> {
    const GLYPH: &'static str = "glyph";
    const GROUP: &'static str = "group";

    pub(crate) fn of(side: &'a font::KerningSide) -> Self {
        match side {
            font::KerningSide::Glyph(glyph_id) => Self {
                kind: Self::GLYPH,
                value: glyph_id.as_str(),
            },
            font::KerningSide::Group(group_id) => Self {
                kind: Self::GROUP,
                value: group_id.as_str(),
            },
        }
    }

    /// Reads a side back from its two columns.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::InvalidDocument`] for an unknown kind.
    pub(crate) fn read(kind: &str, value: String) -> Result<font::KerningSide, StoreError> {
        match kind {
            Self::GLYPH => Ok(font::KerningSide::Glyph(font::GlyphId::from_raw(value))),
            Self::GROUP => Ok(font::KerningSide::Group(font::KerningGroupId::from_raw(
                value,
            ))),
            _ => Err(StoreError::InvalidDocument(format!(
                "unknown kerning side kind {kind:?}"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip<T: ToSql + FromSql>(value: T) -> rusqlite::Result<T> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.query_row("SELECT ?1", [value], |row| row.get(0))
    }

    #[test]
    fn named_columns_round_trip_and_reject_unknown_names() {
        for kind in [
            font::MetricKind::Ascender,
            font::MetricKind::CapHeight,
            font::MetricKind::XHeight,
            font::MetricKind::Baseline,
            font::MetricKind::Descender,
            font::MetricKind::Custom,
        ] {
            assert_eq!(round_trip(MetricKindColumn(kind)).unwrap().0, kind);
        }
        for role in [font::AxisRole::External, font::AxisRole::Internal] {
            assert_eq!(round_trip(AxisRoleColumn(role)).unwrap().0, role);
        }

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let unknown = conn.query_row("SELECT 'sideways'", [], |row| {
            row.get::<_, AxisRoleColumn>(0)
        });
        assert!(matches!(
            unknown,
            Err(rusqlite::Error::FromSqlConversionFailure(0, _, _))
        ));
    }

    #[test]
    fn kerning_columns_round_trip() {
        for position in [font::KerningPosition::First, font::KerningPosition::Second] {
            assert_eq!(
                round_trip(KerningPositionColumn(position)).unwrap().0,
                position
            );
        }

        let side = font::KerningSide::Group(font::KerningGroupId::from_raw("public.kern1.A"));
        let columns = KerningSideColumns::of(&side);
        assert_eq!(
            KerningSideColumns::read(columns.kind, columns.value.to_string()).unwrap(),
            side
        );
        assert!(KerningSideColumns::read("class", String::new()).is_err());
    }
}
