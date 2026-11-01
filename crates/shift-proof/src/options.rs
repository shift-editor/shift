//! OpenType features and segment properties a proof is shaped with.

use std::fmt;
use std::str::FromStr;

use serde::{Serialize, Serializer};
use shift_text::shape::{self, Language, Script, ShapeDirection};

use crate::ProofError;

/// One feature setting in HarfBuzz syntax: `ss01`, `-liga`, `kern=0`,
/// `aalt=2`, or a ranged form such as `kern[3:5]=0`.
#[derive(Clone, Debug, PartialEq)]
pub struct FeatureSetting {
    text: String,
    setting: shape::FeatureSetting,
}

impl FromStr for FeatureSetting {
    type Err = ProofError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let text = text.trim();
        let setting =
            text.parse::<shape::FeatureSetting>()
                .map_err(|_| ProofError::InvalidFeature {
                    text: text.to_string(),
                })?;
        Ok(Self {
            text: text.to_string(),
            setting,
        })
    }
}

/// An ISO 15924 script tag such as `arab` or `Latn`.
#[derive(Clone, Debug, PartialEq)]
pub struct ScriptSetting {
    text: String,
    /// The script's tag as shaping names it, such as `Arab` for `arab`.
    tag: String,
}

impl ScriptSetting {
    /// The script's ISO 15924 tag, as a shape request takes it.
    pub(crate) fn tag(&self) -> &str {
        &self.tag
    }
}

impl FromStr for ScriptSetting {
    type Err = ProofError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let text = text.trim();
        let script = Script::from_str(text).map_err(|_| ProofError::InvalidScript {
            text: text.to_string(),
        })?;
        Ok(Self {
            text: text.to_string(),
            tag: String::from_utf8_lossy(&script.tag().to_be_bytes()).into_owned(),
        })
    }
}

/// A BCP 47 language tag such as `tr` or `ar-EG`, which selects `locl`
/// forms through the font's language systems.
#[derive(Clone, Debug, PartialEq)]
pub struct LanguageSetting {
    text: String,
}

impl LanguageSetting {
    /// The language tag, as a shape request takes it.
    pub(crate) fn tag(&self) -> &str {
        &self.text
    }
}

impl FromStr for LanguageSetting {
    type Err = ProofError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let text = text.trim();
        Language::from_str(text).map_err(|_| ProofError::InvalidLanguage {
            text: text.to_string(),
        })?;
        Ok(Self {
            text: text.to_string(),
        })
    }
}

macro_rules! display_as_text {
    ($($setting:ty),*) => {$(
        impl fmt::Display for $setting {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.text)
            }
        }

        impl Serialize for $setting {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.text)
            }
        }
    )*};
}

display_as_text!(FeatureSetting, ScriptSetting, LanguageSetting);

/// Direction text runs in.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum TextDirection {
    #[serde(rename = "ltr")]
    LeftToRight,
    #[serde(rename = "rtl")]
    RightToLeft,
    #[serde(rename = "ttb")]
    TopToBottom,
    #[serde(rename = "btt")]
    BottomToTop,
}

impl TextDirection {
    /// Whether glyphs stack vertically.
    pub fn is_vertical(self) -> bool {
        matches!(self, Self::TopToBottom | Self::BottomToTop)
    }

    /// Whether logical order runs against the visual order, so pieces of a
    /// line are placed last-first.
    pub fn is_backward(self) -> bool {
        matches!(self, Self::RightToLeft | Self::BottomToTop)
    }
}

impl From<TextDirection> for ShapeDirection {
    fn from(direction: TextDirection) -> Self {
        match direction {
            TextDirection::LeftToRight => Self::LeftToRight,
            TextDirection::RightToLeft => Self::RightToLeft,
            TextDirection::TopToBottom => Self::TopToBottom,
            TextDirection::BottomToTop => Self::BottomToTop,
        }
    }
}

impl From<ShapeDirection> for TextDirection {
    fn from(direction: ShapeDirection) -> Self {
        match direction {
            ShapeDirection::LeftToRight => Self::LeftToRight,
            ShapeDirection::RightToLeft => Self::RightToLeft,
            ShapeDirection::TopToBottom => Self::TopToBottom,
            ShapeDirection::BottomToTop => Self::BottomToTop,
        }
    }
}

impl From<shape::TextDirection> for TextDirection {
    fn from(direction: shape::TextDirection) -> Self {
        ShapeDirection::from(direction).into()
    }
}

impl fmt::Display for TextDirection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::LeftToRight => "ltr",
            Self::RightToLeft => "rtl",
            Self::TopToBottom => "ttb",
            Self::BottomToTop => "btt",
        })
    }
}

impl FromStr for TextDirection {
    type Err = ProofError;

    /// Parses `ltr`, `rtl`, `ttb`, or `btt`, ignoring ASCII case.
    fn from_str(text: &str) -> Result<Self, Self::Err> {
        match text.trim().to_ascii_lowercase().as_str() {
            "ltr" => Ok(Self::LeftToRight),
            "rtl" => Ok(Self::RightToLeft),
            "ttb" => Ok(Self::TopToBottom),
            "btt" => Ok(Self::BottomToTop),
            _ => Err(ProofError::InvalidDirection {
                text: text.to_string(),
            }),
        }
    }
}

/// How text is shaped. Each field left empty is guessed from the text or
/// left to the font's defaults, as HarfBuzz does.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShapingOptions {
    /// Applied on top of the font's default features, in order.
    pub features: Vec<FeatureSetting>,
    pub script: Option<ScriptSetting>,
    pub language: Option<LanguageSetting>,
    pub direction: Option<TextDirection>,
}

impl ShapingOptions {
    /// The feature settings, as a shape request takes them.
    pub(crate) fn shape_features(&self) -> Vec<shape::FeatureSetting> {
        self.features
            .iter()
            .map(|feature| feature.setting)
            .collect()
    }

    /// The paragraph direction a horizontal line is ordered in; `None` for
    /// its first strong character's, or for a vertical direction.
    pub(crate) fn base_direction(&self) -> Option<shape::TextDirection> {
        self.direction
            .and_then(|direction| ShapeDirection::from(direction).horizontal())
    }
}
