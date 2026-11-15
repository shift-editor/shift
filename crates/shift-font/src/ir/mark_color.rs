//! Mark colours: the colour a designer tags a glyph with to organise a font.
//!
//! A glyph has at most one, whatever the source. It is one of the twelve
//! colours Glyphs offers, by name, or any other colour by value. A named
//! colour keeps its name wherever it is stored, so a theme may draw it in its
//! own shade; [`NamedMarkColor::rgba`] is the value other tools read for it.

use serde::{Deserialize, Serialize};

/// Text that names no mark colour: neither a [`NamedMarkColor`] name nor
/// four comma-separated channels between 0 and 1.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0:?} is not a mark colour")]
pub struct InvalidMarkColor(pub String);

crate::string_enum! {
    /// One of Glyphs' twelve label colours, in Glyphs' order: a colour's
    /// place in [`NamedMarkColor::ALL`] is the index a Glyphs file stores
    /// for it.
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
    #[cfg_attr(feature = "pack", derive(pack::Pack))]
    pub enum NamedMarkColor {
        Red => "red",
        Orange => "orange",
        Brown => "brown",
        Yellow => "yellow",
        LightGreen => "lightGreen",
        DarkGreen => "darkGreen",
        LightBlue => "lightBlue",
        DarkBlue => "darkBlue",
        Purple => "purple",
        Magenta => "magenta",
        LightGray => "lightGray",
        Charcoal => "charcoal",
    }
    parse_error: InvalidMarkColor = |text| InvalidMarkColor(text.to_string());
}

impl NamedMarkColor {
    /// The value glyphsLib writes for the colour in a UFO's
    /// `public.markColor`, which is how other tools exchange it.
    pub fn rgba(self) -> Rgba {
        let [red, green, blue] = match self {
            Self::Red => [0.85, 0.26, 0.06],
            Self::Orange => [0.99, 0.62, 0.11],
            Self::Brown => [0.65, 0.48, 0.2],
            Self::Yellow => [0.97, 1.0, 0.0],
            Self::LightGreen => [0.67, 0.95, 0.38],
            Self::DarkGreen => [0.04, 0.57, 0.04],
            Self::LightBlue => [0.0, 0.67, 0.91],
            Self::DarkBlue => [0.18, 0.16, 0.78],
            Self::Purple => [0.5, 0.09, 0.79],
            Self::Magenta => [0.98, 0.36, 0.67],
            Self::LightGray => [0.75, 0.75, 0.75],
            Self::Charcoal => [0.25, 0.25, 0.25],
        };
        Rgba {
            red,
            green,
            blue,
            alpha: 1.0,
        }
    }
}

/// A colour as red, green, blue and alpha, each from 0 to 1, as a UFO
/// writes colours.
///
/// Its text form is the UFO one: the four channels separated by commas,
/// such as `0.5,0.09,0.79,1`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct Rgba {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
    pub alpha: f64,
}

impl Rgba {
    fn channels(self) -> [f64; 4] {
        [self.red, self.green, self.blue, self.alpha]
    }

    /// Whether every channel is a number from 0 to 1.
    pub fn is_valid(self) -> bool {
        self.channels()
            .into_iter()
            .all(|channel| (0.0..=1.0).contains(&channel))
    }
}

impl std::fmt::Display for Rgba {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Self {
            red,
            green,
            blue,
            alpha,
        } = self;
        write!(formatter, "{red},{green},{blue},{alpha}")
    }
}

impl std::str::FromStr for Rgba {
    type Err = InvalidMarkColor;

    /// Reads four comma-separated channels, with or without spaces around
    /// them.
    ///
    /// # Errors
    ///
    /// Returns [`InvalidMarkColor`] unless `text` is exactly four numbers
    /// from 0 to 1.
    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let invalid = || InvalidMarkColor(text.to_string());
        let mut channels = text.split(',').map(|channel| channel.trim().parse::<f64>());
        let mut next = || channels.next().and_then(Result::ok).ok_or_else(invalid);
        let color = Self {
            red: next()?,
            green: next()?,
            blue: next()?,
            alpha: next()?,
        };
        if channels.next().is_some() || !color.is_valid() {
            return Err(invalid());
        }
        Ok(color)
    }
}

/// The colour a glyph is tagged with.
///
/// Its text form is the colour's name for [`MarkColor::Named`] and the
/// [`Rgba`] text for [`MarkColor::Custom`].
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum MarkColor {
    Named(NamedMarkColor),
    /// A colour outside the twelve, as another tool wrote it.
    Custom(Rgba),
}

impl MarkColor {
    /// The colour's value: a named colour's is [`NamedMarkColor::rgba`].
    pub fn rgba(self) -> Rgba {
        match self {
            Self::Named(named) => named.rgba(),
            Self::Custom(rgba) => rgba,
        }
    }

    /// Whether the colour can be stored: a custom colour's channels must
    /// each be from 0 to 1.
    pub fn is_valid(self) -> bool {
        self.rgba().is_valid()
    }
}

/// The named colour with exactly this value, or else a custom colour.
impl From<Rgba> for MarkColor {
    fn from(rgba: Rgba) -> Self {
        NamedMarkColor::ALL
            .iter()
            .find(|named| named.rgba() == rgba)
            .map_or(Self::Custom(rgba), |named| Self::Named(*named))
    }
}

impl std::fmt::Display for MarkColor {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Named(named) => named.fmt(formatter),
            Self::Custom(rgba) => rgba.fmt(formatter),
        }
    }
}

impl std::str::FromStr for MarkColor {
    type Err = InvalidMarkColor;

    /// Reads a named colour's name, or else [`Rgba`] text as a custom
    /// colour, without matching it to a named one.
    ///
    /// # Errors
    ///
    /// Returns [`InvalidMarkColor`] when `text` is neither.
    fn from_str(text: &str) -> Result<Self, Self::Err> {
        if let Ok(named) = text.parse() {
            return Ok(Self::Named(named));
        }
        text.parse().map(Self::Custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_named_colour_is_the_colour_its_value_names() {
        for named in NamedMarkColor::ALL {
            assert_eq!(MarkColor::from(named.rgba()), MarkColor::Named(*named));
        }
    }

    #[test]
    fn a_value_outside_the_palette_is_a_custom_colour() {
        let almost_red: Rgba = "0.85,0.26,0.07,1".parse().unwrap();

        assert_eq!(MarkColor::from(almost_red), MarkColor::Custom(almost_red));
    }

    #[test]
    fn colours_read_back_from_their_text() {
        let custom = MarkColor::Custom(Rgba {
            red: 0.1,
            green: 0.5,
            blue: 1.0,
            alpha: 0.25,
        });
        assert_eq!(custom.to_string(), "0.1,0.5,1,0.25");
        assert_eq!(custom.to_string().parse(), Ok(custom));

        let named = MarkColor::Named(NamedMarkColor::LightGreen);
        assert_eq!(named.to_string(), "lightGreen");
        assert_eq!("lightGreen".parse(), Ok(named));
        assert_eq!(NamedMarkColor::Yellow.rgba().to_string(), "0.97,1,0,1");
    }

    #[test]
    fn rgba_text_allows_spaces_and_rejects_anything_but_four_channels_in_range() {
        assert_eq!(
            " 1, 0 ,0.5,1 ".parse(),
            Ok(Rgba {
                red: 1.0,
                green: 0.0,
                blue: 0.5,
                alpha: 1.0,
            })
        );
        for text in [
            "",
            "1,0,0",
            "1,0,0,1,1",
            "1,0,0,2",
            "1,0,0,-0.1",
            "1,0,0,NaN",
            "red,0,0,1",
        ] {
            assert_eq!(
                text.parse::<Rgba>(),
                Err(InvalidMarkColor(text.to_string())),
                "{text:?}"
            );
        }
    }
}
