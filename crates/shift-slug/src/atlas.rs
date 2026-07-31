use std::cmp::Ordering;

use crate::{
    curve::curves_from_commands, Bounds, Curve, CurveIndexEncoding, Layout, OutlineCommand,
    PackedAtlas, SlugError,
};

pub const DEFAULT_BAND_COUNT: u32 = 8;
pub const MAX_BAND_COUNT: u32 = 256;

/// One contiguous range in the global curve-index array.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Band {
    pub start: u32,
    pub count: u32,
}

/// Static Slug metadata for one glyph.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Glyph {
    pub bounds: Bounds,
    pub curve_start: u32,
    pub curve_count: u32,
    pub band_start: u32,
    pub band_count: u32,
}

/// CPU-owned static Slug atlas.
#[derive(Clone, Debug)]
pub struct Atlas {
    band_count: u32,
    curves: Vec<Curve>,
    curve_indices: Vec<u32>,
    glyphs: Vec<Glyph>,
    bands: Vec<Band>,
}

impl Atlas {
    pub fn band_count(&self) -> u32 {
        self.band_count
    }

    pub fn curves(&self) -> &[Curve] {
        &self.curves
    }

    pub fn curve_indices(&self) -> &[u32] {
        &self.curve_indices
    }

    pub fn glyphs(&self) -> &[Glyph] {
        &self.glyphs
    }

    pub fn bands(&self) -> &[Band] {
        &self.bands
    }

    pub fn bands_for(&self, glyph: Glyph) -> (&[Band], &[Band]) {
        let start = glyph.band_start as usize;
        let middle = start + glyph.band_count as usize;
        let end = middle + glyph.band_count as usize;
        (&self.bands[start..middle], &self.bands[middle..end])
    }

    pub fn statistics(&self) -> Statistics {
        Statistics {
            glyph_count: self.glyphs.len(),
            curve_count: self.curves.len(),
            curve_index_count: self.curve_indices.len(),
            band_count: self.bands.len(),
            bands_per_direction: self.band_count,
            max_curves_per_glyph: self
                .glyphs
                .iter()
                .map(|glyph| glyph.curve_count)
                .max()
                .unwrap_or(0),
            max_band_occupancy: self.bands.iter().map(|band| band.count).max().unwrap_or(0),
        }
    }

    pub fn layout(&self, alignment: usize) -> Result<Layout, SlugError> {
        self.layout_with_encoding(alignment, CurveIndexEncoding::GlobalU32)
    }

    pub fn layout_with_encoding(
        &self,
        alignment: usize,
        index_encoding: CurveIndexEncoding,
    ) -> Result<Layout, SlugError> {
        Layout::new(self, alignment, index_encoding)
    }

    pub fn pack(&self, alignment: usize) -> Result<PackedAtlas, SlugError> {
        self.pack_with_encoding(alignment, CurveIndexEncoding::GlobalU32)
    }

    pub fn pack_with_encoding(
        &self,
        alignment: usize,
        index_encoding: CurveIndexEncoding,
    ) -> Result<PackedAtlas, SlugError> {
        PackedAtlas::new(self, alignment, index_encoding)
    }
}

/// Atlas sizing and occupancy summary.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Statistics {
    pub glyph_count: usize,
    pub curve_count: usize,
    pub curve_index_count: usize,
    pub band_count: usize,
    pub bands_per_direction: u32,
    pub max_curves_per_glyph: u32,
    pub max_band_occupancy: u32,
}

/// Incremental static-atlas builder with one band count shared by every glyph.
#[derive(Debug)]
pub struct AtlasBuilder {
    atlas: Atlas,
}

impl AtlasBuilder {
    pub fn new(band_count: u32) -> Result<Self, SlugError> {
        if !(1..=MAX_BAND_COUNT).contains(&band_count) {
            return Err(SlugError::InvalidBandCount(band_count));
        }

        Ok(Self {
            atlas: Atlas {
                band_count,
                curves: Vec::new(),
                curve_indices: Vec::new(),
                glyphs: Vec::new(),
                bands: Vec::new(),
            },
        })
    }

    pub fn add_glyph(
        &mut self,
        commands: impl IntoIterator<Item = OutlineCommand<f32>>,
    ) -> Result<u32, SlugError> {
        let curves = curves_from_commands(commands)?;
        let curve_start = as_u32(self.atlas.curves.len())?;
        let curve_count = as_u32(curves.len())?;
        let bounds = glyph_bounds(&curves);
        let (local_bands, local_indices) = build_bands(&curves, bounds, self.atlas.band_count)?;
        let index_start = as_u32(self.atlas.curve_indices.len())?;
        let band_start = as_u32(self.atlas.bands.len())?;
        let glyph_index = as_u32(self.atlas.glyphs.len())?;

        let mut bands = Vec::with_capacity(local_bands.len());
        for band in local_bands {
            bands.push(Band {
                start: index_start
                    .checked_add(band.start)
                    .ok_or(SlugError::LengthOverflow)?,
                count: band.count,
            });
        }

        let mut indices = Vec::with_capacity(local_indices.len());
        for local_index in local_indices {
            indices.push(
                curve_start
                    .checked_add(local_index)
                    .ok_or(SlugError::LengthOverflow)?,
            );
        }

        ensure_total(self.atlas.curves.len(), curves.len())?;
        ensure_total(self.atlas.curve_indices.len(), indices.len())?;
        ensure_total(self.atlas.bands.len(), bands.len())?;
        ensure_total(self.atlas.glyphs.len(), 1)?;

        self.atlas.curves.extend(curves);
        self.atlas.curve_indices.extend(indices);
        self.atlas.bands.extend(bands);
        self.atlas.glyphs.push(Glyph {
            bounds,
            curve_start,
            curve_count,
            band_start,
            band_count: self.atlas.band_count,
        });

        Ok(glyph_index)
    }

    pub fn finish(self) -> Atlas {
        self.atlas
    }
}

impl Default for AtlasBuilder {
    fn default() -> Self {
        Self::new(DEFAULT_BAND_COUNT).expect("default Slug band count is valid")
    }
}

fn glyph_bounds(curves: &[Curve]) -> Bounds {
    let Some(first) = curves.first() else {
        return Bounds::default();
    };
    let mut bounds = first.bounds();

    for curve in &curves[1..] {
        let curve_bounds = curve.bounds();
        bounds.min_x = bounds.min_x.min(curve_bounds.min_x);
        bounds.min_y = bounds.min_y.min(curve_bounds.min_y);
        bounds.max_x = bounds.max_x.max(curve_bounds.max_x);
        bounds.max_y = bounds.max_y.max(curve_bounds.max_y);
    }

    bounds
}

fn build_bands(
    curves: &[Curve],
    bounds: Bounds,
    band_count: u32,
) -> Result<(Vec<Band>, Vec<u32>), SlugError> {
    let count = band_count as usize;
    let mut horizontal = vec![Vec::new(); count];
    let mut vertical = vec![Vec::new(); count];

    for (curve_index, curve) in curves.iter().copied().enumerate() {
        let curve_index = as_u32(curve_index)?;
        let curve_bounds = curve.bounds();
        let (first, last) = band_span(
            curve_bounds.min_y,
            curve_bounds.max_y,
            bounds.min_y,
            bounds.height(),
            count,
        );
        for band in &mut horizontal[first..=last] {
            band.push(curve_index);
        }

        let (first, last) = band_span(
            curve_bounds.min_x,
            curve_bounds.max_x,
            bounds.min_x,
            bounds.width(),
            count,
        );
        for band in &mut vertical[first..=last] {
            band.push(curve_index);
        }
    }

    for band in &mut horizontal {
        band.sort_unstable_by(|left, right| {
            descending(
                curves[*left as usize].max_x(),
                curves[*right as usize].max_x(),
            )
        });
    }
    for band in &mut vertical {
        band.sort_unstable_by(|left, right| {
            descending(
                curves[*left as usize].max_y(),
                curves[*right as usize].max_y(),
            )
        });
    }

    let mut ranges = Vec::with_capacity(count * 2);
    let mut indices = Vec::new();
    for band in horizontal.into_iter().chain(vertical) {
        let start = as_u32(indices.len())?;
        let count = as_u32(band.len())?;
        ensure_total(indices.len(), band.len())?;
        ranges.push(Band { start, count });
        indices.extend(band);
    }

    Ok((ranges, indices))
}

fn band_span(
    minimum: f32,
    maximum: f32,
    glyph_minimum: f32,
    glyph_span: f32,
    band_count: usize,
) -> (usize, usize) {
    if glyph_span <= f32::EPSILON {
        return (0, 0);
    }

    let band = |value: f32| {
        (((value - glyph_minimum) / glyph_span) * band_count as f32)
            .floor()
            .clamp(0.0, (band_count - 1) as f32) as usize
    };
    (band(minimum), band(maximum))
}

fn descending(left: f32, right: f32) -> Ordering {
    right.total_cmp(&left)
}

fn as_u32(value: usize) -> Result<u32, SlugError> {
    u32::try_from(value).map_err(|_| SlugError::LengthOverflow)
}

fn ensure_total(current: usize, additional: usize) -> Result<(), SlugError> {
    let total = current
        .checked_add(additional)
        .ok_or(SlugError::LengthOverflow)?;
    as_u32(total).map(|_| ())
}
