use std::str::FromStr;

use fontdrasil::{
    coords::{NormalizedCoord, NormalizedLocation},
    types::Tag,
};

use crate::{Axis, Location};

pub fn to_fd_location(loc: &Location, axes: &[Axis]) -> NormalizedLocation {
    let mut result = NormalizedLocation::new();

    for axis in axes {
        let value = loc.get(axis.tag()).unwrap_or(axis.default());
        let n = axis.normalize(value);
        let Ok(tag) = Tag::from_str(axis.tag()) else {
            continue;
        };

        result.insert(tag, NormalizedCoord::new(n));
    }

    result
}
