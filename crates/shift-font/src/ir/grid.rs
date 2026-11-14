//! The canvas grid a font is drawn on, stored in its lib.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::ir::lib_data::LibValue;

/// The font lib key a font's [`Grid`] is stored under.
pub const GRID_LIB_KEY: &str = "com.shift.grid";

/// The most divisions one grid cell takes along an axis.
pub const MAX_GRID_SUBDIVISIONS: u32 = 16;

/// The grid a font is drawn on: line spacing on each axis and how many
/// divisions each cell takes.
///
/// Spacing is in font units, counted from a glyph's origin. Whether the grid
/// is shown or snapped to is a choice of the window, not the font, and is not
/// stored here.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(rename_all = "camelCase")]
pub struct Grid {
    pub spacing_x: f64,
    pub spacing_y: f64,
    pub subdivisions: u32,
}

impl Grid {
    /// Checks that both spacings are positive finite numbers and that
    /// subdivisions run from 1 to [`MAX_GRID_SUBDIVISIONS`].
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidGrid`] naming the grid when either check fails.
    pub fn validate(self) -> CoreResult<Self> {
        let spacing_valid = |spacing: f64| spacing.is_finite() && spacing > 0.0;
        let subdivisions_valid = (1..=MAX_GRID_SUBDIVISIONS).contains(&self.subdivisions);
        if spacing_valid(self.spacing_x) && spacing_valid(self.spacing_y) && subdivisions_valid {
            return Ok(self);
        }

        Err(CoreError::InvalidGrid(self))
    }

    /// Reads a grid stored under [`GRID_LIB_KEY`].
    ///
    /// Returns `None` for a value that is not a dict of the three fields, or
    /// whose fields fail [`Self::validate`], as a hand-edited or foreign lib
    /// may hold; the font then reads as storing no grid.
    pub fn from_lib(value: &LibValue) -> Option<Self> {
        let LibValue::Dict(fields) = value else {
            return None;
        };
        let grid = Self {
            spacing_x: lib_number(fields.get("spacingX")?)?,
            spacing_y: lib_number(fields.get("spacingY")?)?,
            subdivisions: u32::try_from(lib_integer(fields.get("subdivisions")?)?).ok()?,
        };

        grid.validate().ok()
    }

    /// The lib value [`Self::from_lib`] reads back.
    pub fn to_lib(self) -> LibValue {
        LibValue::Dict(BTreeMap::from([
            ("spacingX".to_string(), LibValue::Float(self.spacing_x)),
            ("spacingY".to_string(), LibValue::Float(self.spacing_y)),
            (
                "subdivisions".to_string(),
                LibValue::Integer(i64::from(self.subdivisions)),
            ),
        ]))
    }
}

fn lib_number(value: &LibValue) -> Option<f64> {
    match value {
        LibValue::Float(number) => Some(*number),
        LibValue::Integer(number) => Some(*number as f64),
        _ => None,
    }
}

fn lib_integer(value: &LibValue) -> Option<i64> {
    match value {
        LibValue::Integer(number) => Some(*number),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(spacing_x: f64, spacing_y: f64, subdivisions: u32) -> Grid {
        Grid {
            spacing_x,
            spacing_y,
            subdivisions,
        }
    }

    #[test]
    fn round_trips_through_the_lib() {
        let stored = grid(50.0, 25.5, 4);

        assert_eq!(Grid::from_lib(&stored.to_lib()), Some(stored));
    }

    #[test]
    fn reads_whole_number_spacing_written_as_integers() {
        let value = LibValue::Dict(BTreeMap::from([
            ("spacingX".to_string(), LibValue::Integer(100)),
            ("spacingY".to_string(), LibValue::Integer(80)),
            ("subdivisions".to_string(), LibValue::Integer(2)),
        ]));

        assert_eq!(Grid::from_lib(&value), Some(grid(100.0, 80.0, 2)));
    }

    #[test]
    fn reads_a_malformed_or_invalid_value_as_no_grid() {
        assert_eq!(Grid::from_lib(&LibValue::String("100".to_string())), None);
        assert_eq!(Grid::from_lib(&grid(0.0, 100.0, 1).to_lib()), None);
        assert_eq!(Grid::from_lib(&grid(100.0, 100.0, 17).to_lib()), None);
    }

    #[test]
    fn rejects_spacing_that_is_not_positive_and_subdivisions_out_of_range() {
        for invalid in [
            grid(-10.0, 100.0, 1),
            grid(100.0, f64::NAN, 1),
            grid(100.0, 100.0, 0),
            grid(100.0, 100.0, MAX_GRID_SUBDIVISIONS + 1),
        ] {
            assert!(matches!(invalid.validate(), Err(CoreError::InvalidGrid(_))));
        }
        assert_eq!(
            grid(100.0, 100.0, 16).validate().ok(),
            Some(grid(100.0, 100.0, 16))
        );
    }
}
