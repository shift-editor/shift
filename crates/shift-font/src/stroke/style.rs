//! Packable stroke style fields for intents and future bridge DTOs.

use super::exact_offset::ExactStrokeStyle;
use crate::{CoreError, CoreResult};
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

/// Width, caps, joins, miter limit, and position of a stroke.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct OutlineStrokeStyle {
    pub width: f64,
    pub cap: StrokeCap,
    pub join: StrokeJoin,
    pub miter_limit: f64,
    /// Where the stroke lies relative to its skeleton, from `-1` (entirely
    /// left of the direction of travel) through `0` (centred) to `1`
    /// (entirely right); shown as −100 % … +100 %.
    pub position: f64,
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
            position: 0.0,
        }
    }

    /// Checks that the style can be solved.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StrokeOperationFailed`] when the width is not a
    /// finite value above zero, the miter limit is not a finite value above
    /// zero, or the position is not a finite value between -1 and 1.
    pub fn require_valid(&self) -> CoreResult<()> {
        if !(self.width > 0.0 && self.width.is_finite()) {
            return Err(CoreError::StrokeOperationFailed {
                message: "stroke width must be a finite value greater than zero".to_string(),
            });
        }

        if !(self.miter_limit > 0.0 && self.miter_limit.is_finite()) {
            return Err(CoreError::StrokeOperationFailed {
                message: "miter limit must be a finite value greater than zero".to_string(),
            });
        }

        if !(-1.0..=1.0).contains(&self.position) {
            return Err(CoreError::StrokeOperationFailed {
                message: "stroke position must be between -1 and 1".to_string(),
            });
        }

        Ok(())
    }

    pub fn to_exact(self) -> ExactStrokeStyle {
        ExactStrokeStyle {
            width: self.width,
            cap: self.cap.to_kurbo(),
            join: self.join.to_kurbo(),
            miter_limit: self.miter_limit,
            position: self.position,
        }
    }
}
