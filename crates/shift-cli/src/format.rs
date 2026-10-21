//! How the CLI prints numbers, design-space coordinates and font versions.

use std::fmt;
use std::str::FromStr;

use miette::{IntoDiagnostic, Report, bail};

/// Decimal places a [`Number`] keeps.
const NUMBER_DECIMALS: usize = 4;

/// A number as reports print it: at most four decimals, without trailing
/// zeros, and `0` rather than `-0`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Number(pub f64);

impl fmt::Display for Number {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = format!("{:.*}", NUMBER_DECIMALS, self.0);
        let text = if text.contains('.') {
            text.trim_end_matches('0').trim_end_matches('.')
        } else {
            &text
        };
        formatter.write_str(if text == "-0" { "0" } else { text })
    }
}

/// One axis value of a location, as reports carry it.
pub(crate) trait Coordinate {
    fn axis_tag(&self) -> &str;
    fn value(&self) -> f64;
}

/// A location as `tag=value` pairs separated by spaces, or `{}` when empty.
pub(crate) struct Coordinates<'a, C>(&'a [C]);

impl<'a, C: Coordinate> Coordinates<'a, C> {
    pub(crate) fn of(values: &'a [C]) -> Self {
        Self(values)
    }
}

impl<C: Coordinate> fmt::Display for Coordinates<'_, C> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0.is_empty() {
            return formatter.write_str("{}");
        }
        for (index, coordinate) in self.0.iter().enumerate() {
            if index > 0 {
                formatter.write_str(" ")?;
            }
            write!(
                formatter,
                "{}={}",
                coordinate.axis_tag(),
                Number(coordinate.value())
            )?;
        }
        Ok(())
    }
}

/// A font version as `head.versionMajor` and `head.versionMinor` store it,
/// written `MAJOR.NNN`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FontVersion {
    pub major: i32,
    pub minor: i32,
}

impl FontVersion {
    /// The version a font's metadata records; a missing minor reads as `000`.
    pub(crate) fn from_metadata(major: Option<i32>, minor: Option<i32>) -> Option<Self> {
        Some(Self {
            major: major?,
            minor: minor.unwrap_or_default(),
        })
    }
}

impl fmt::Display for FontVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}.{:03}", self.major, self.minor)
    }
}

impl FromStr for FontVersion {
    type Err = Report;

    /// Parses `MAJOR` or `MAJOR.NNN`, such as `1.000` or `2.125`.
    fn from_str(version: &str) -> Result<Self, Self::Err> {
        let (major, minor) = version
            .trim()
            .split_once('.')
            .unwrap_or_else(|| (version.trim(), "000"));
        let digits =
            |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
        if !digits(major) || !digits(minor) || minor.len() != 3 {
            bail!("invalid --version {version:?}; use MAJOR or MAJOR.NNN, such as 1.000 or 2.125");
        }
        let major = major.parse::<i32>().into_diagnostic()?;
        if major > i32::from(i16::MAX) {
            bail!("--version major must be between 0 and 32767");
        }
        Ok(Self {
            major,
            minor: minor.parse::<i32>().into_diagnostic()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_keep_four_decimals_without_trailing_zeros() {
        assert_eq!(Number(400.0).to_string(), "400");
        assert_eq!(Number(0.5).to_string(), "0.5");
        assert_eq!(Number(1.0 / 3.0).to_string(), "0.3333");
        assert_eq!(Number(-12.25).to_string(), "-12.25");
    }

    #[test]
    fn numbers_that_round_to_zero_print_without_a_sign() {
        assert_eq!(Number(-0.0).to_string(), "0");
        assert_eq!(Number(-0.00001).to_string(), "0");
    }

    impl Coordinate for (&str, f64) {
        fn axis_tag(&self) -> &str {
            self.0
        }

        fn value(&self) -> f64 {
            self.1
        }
    }

    #[test]
    fn coordinates_join_tags_and_values() {
        let location = [("wght", 400.0), ("wdth", 87.5)];
        let empty: [(&str, f64); 0] = [];

        assert_eq!(Coordinates::of(&location).to_string(), "wght=400 wdth=87.5");
        assert_eq!(Coordinates::of(&empty).to_string(), "{}");
    }

    #[test]
    fn font_versions_round_trip_through_text() {
        let version = "2.125".parse::<FontVersion>().unwrap();

        assert_eq!(
            version,
            FontVersion {
                major: 2,
                minor: 125
            }
        );
        assert_eq!(version.to_string(), "2.125");
        assert_eq!("3".parse::<FontVersion>().unwrap().to_string(), "3.000");
        assert!("1.5".parse::<FontVersion>().is_err());
        assert!("40000".parse::<FontVersion>().is_err());
    }
}
