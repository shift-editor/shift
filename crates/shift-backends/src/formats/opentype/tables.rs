use skrifa::raw::tables::glyf::Glyf;
use skrifa::raw::tables::gvar::Gvar;
use skrifa::raw::tables::loca::Loca;
use skrifa::raw::types::MajorMinor;
use skrifa::raw::{ReadError, TableProvider};
use skrifa::FontRef;

use crate::font_source::{malformed, FontReadError};

use super::OpenTypeFont;

type VariableTables<'a> = (Loca<'a>, Glyf<'a>, Option<Gvar<'a>>);

pub(super) fn variable_tables(
    source: &OpenTypeFont,
) -> Result<(FontRef<'_>, Option<VariableTables<'_>>), FontReadError> {
    let font = FontRef::new(source.bytes().as_ref()).map_err(|error| {
        malformed(
            &source.path,
            format!("failed to reopen retained font: {error}"),
        )
    })?;
    reject_unsupported_tables(source, &font)?;
    let loca = match font.loca(None) {
        Ok(loca) => loca,
        Err(ReadError::TableIsMissing(_)) => return Ok((font, None)),
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read loca table: {error}"),
            ))
        }
    };
    let glyf = font.glyf().map_err(|error| match error {
        ReadError::TableIsMissing(_) => FontReadError::UnsupportedProjection {
            details: "location-independent OpenType geometry requires glyf outlines",
        },
        error => malformed(&source.path, format!("failed to read glyf table: {error}")),
    })?;
    let gvar = match font.gvar() {
        Ok(gvar) => Some(gvar),
        Err(ReadError::TableIsMissing(_)) => None,
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read gvar table: {error}"),
            ))
        }
    };

    Ok((font, Some((loca, glyf, gvar))))
}

fn reject_unsupported_tables(
    source: &OpenTypeFont,
    font: &FontRef<'_>,
) -> Result<(), FontReadError> {
    match font.cff2() {
        Ok(_) => {
            return Err(FontReadError::UnsupportedProjection {
                details: "CFF2 projection is not supported",
            })
        }
        Err(ReadError::TableIsMissing(_)) => {}
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read CFF2 table: {error}"),
            ))
        }
    }
    match font.varc() {
        Ok(_) => {
            return Err(FontReadError::UnsupportedProjection {
                details: "VARC projection is not supported",
            })
        }
        Err(ReadError::TableIsMissing(_)) => {}
        Err(error) => {
            return Err(malformed(
                &source.path,
                format!("failed to read VARC table: {error}"),
            ))
        }
    }
    if source
        .avar_version
        .is_some_and(|version| version != MajorMinor::VERSION_1_0)
    {
        return Err(FontReadError::UnsupportedProjection {
            details: "avar version 2 projection is not supported",
        });
    }
    Ok(())
}
