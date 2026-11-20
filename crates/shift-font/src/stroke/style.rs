//! Packable stroke style fields for intents and future bridge DTOs.

use super::exact_offset::ExactStrokeStyle;
use kurbo::{Cap, Join};

crate::string_enum! {
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "pack", derive(pack::Pack))]
    pub enum StrokeCap {
        Butt => "butt",
        Square => "square",
        Round => "round",
    }
    parse_error: String = |text| format!("unknown stroke cap \"{text}\"");
}

crate::string_enum! {
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    #[cfg_attr(feature = "pack", derive(pack::Pack))]
    pub enum StrokeJoin {
        Bevel => "bevel",
        Miter => "miter",
        Round => "round",
    }
    parse_error: String = |text| format!("unknown stroke join \"{text}\"");
}

impl StrokeCap {
    pub fn to_kurbo(self) -> Cap {
        match self {
            Self::Butt => Cap::Butt,
            Self::Square => Cap::Square,
            Self::Round => Cap::Round,
        }
    }
}

impl StrokeJoin {
    pub fn to_kurbo(self) -> Join {
        match self {
            Self::Bevel => Join::Bevel,
            Self::Miter => Join::Miter,
            Self::Round => Join::Round,
        }
    }
}

/// Width, caps, joins, and miter limit for destructive outline stroke.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct OutlineStrokeStyle {
    pub width: f64,
    pub cap: StrokeCap,
    pub join: StrokeJoin,
    pub miter_limit: f64,
}

impl OutlineStrokeStyle {
    pub const DEFAULT_MITER_LIMIT: f64 = 4.0;

    /// Round caps and joins at `width` with kurbo's default miter limit.
    pub fn round(width: f64) -> Self {
        Self {
            width,
            cap: StrokeCap::Round,
            join: StrokeJoin::Round,
            miter_limit: Self::DEFAULT_MITER_LIMIT,
        }
    }

    pub fn to_exact(self) -> ExactStrokeStyle {
        ExactStrokeStyle {
            width: self.width,
            cap: self.cap.to_kurbo(),
            join: self.join.to_kurbo(),
            miter_limit: self.miter_limit,
        }
    }
}
