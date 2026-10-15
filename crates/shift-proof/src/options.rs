//! OpenType features and segment properties a proof is shaped with.

use std::fmt;
use std::str::FromStr;

use serde::{Serialize, Serializer};

use crate::ProofError;

/// One feature setting in HarfBuzz syntax: `ss01`, `-liga`, `kern=0`,
/// `aalt=2`, or a ranged form such as `kern[3:5]=0`.
#[derive(Clone, Debug, PartialEq)]
pub struct FeatureSetting {
    text: String,
    feature: harfrust::Feature,
}

impl FeatureSetting {
    pub(crate) fn feature(&self) -> harfrust::Feature {
        self.feature
    }
}

impl FromStr for FeatureSetting {
    type Err = ProofError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let text = text.trim();
        let feature =
            harfrust::Feature::from_str(text).map_err(|_| ProofError::InvalidFeature {
                text: text.to_string(),
            })?;
        Ok(Self {
            text: text.to_string(),
            feature,
        })
    }
}

/// An ISO 15924 script tag such as `arab` or `Latn`.
#[derive(Clone, Debug, PartialEq)]
pub struct ScriptSetting {
    text: String,
    script: harfrust::Script,
}

impl ScriptSetting {
    pub(crate) fn script(&self) -> harfrust::Script {
        self.script
    }

    pub(crate) fn from_harfrust(script: harfrust::Script) -> Self {
        let tag = script.tag().to_be_bytes();
        Self {
            text: String::from_utf8_lossy(&tag).into_owned(),
            script,
        }
    }
}

impl FromStr for ScriptSetting {
    type Err = ProofError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let text = text.trim();
        let script = harfrust::Script::from_str(text).map_err(|_| ProofError::InvalidScript {
            text: text.to_string(),
        })?;
        Ok(Self {
            text: text.to_string(),
            script,
        })
    }
}

/// A BCP 47 language tag such as `tr` or `ar-EG`, which selects `locl`
/// forms through the font's language systems.
#[derive(Clone, Debug, PartialEq)]
pub struct LanguageSetting {
    text: String,
    language: harfrust::Language,
}

impl LanguageSetting {
    pub(crate) fn language(&self) -> harfrust::Language {
        self.language.clone()
    }
}

impl FromStr for LanguageSetting {
    type Err = ProofError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let text = text.trim();
        let language =
            harfrust::Language::from_str(text).map_err(|_| ProofError::InvalidLanguage {
                text: text.to_string(),
            })?;
        Ok(Self {
            text: text.to_string(),
            language,
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

    pub(crate) fn to_harfrust(self) -> harfrust::Direction {
        match self {
            Self::LeftToRight => harfrust::Direction::LeftToRight,
            Self::RightToLeft => harfrust::Direction::RightToLeft,
            Self::TopToBottom => harfrust::Direction::TopToBottom,
            Self::BottomToTop => harfrust::Direction::BottomToTop,
        }
    }

    pub(crate) fn from_harfrust(direction: harfrust::Direction) -> Self {
        match direction {
            harfrust::Direction::RightToLeft => Self::RightToLeft,
            harfrust::Direction::TopToBottom => Self::TopToBottom,
            harfrust::Direction::BottomToTop => Self::BottomToTop,
            _ => Self::LeftToRight,
        }
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
    pub(crate) fn harfrust_features(&self) -> Vec<harfrust::Feature> {
        self.features.iter().map(FeatureSetting::feature).collect()
    }
}
