use crate::{Atlas, SlugError};

const CURVE_BYTES: usize = 24;
const INDEX_BYTES: usize = 4;
const GLYPH_BYTES: usize = 32;
const BAND_BYTES: usize = 8;

/// One aligned section in a packed GPU upload.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Section {
    pub offset: usize,
    pub length: usize,
}

/// Byte ranges for one contiguous GPU atlas upload.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Layout {
    pub curves: Section,
    pub curve_indices: Section,
    pub glyphs: Section,
    pub bands: Section,
    pub total_length: usize,
}

impl Layout {
    pub(crate) fn new(atlas: &Atlas, alignment: usize) -> Result<Self, SlugError> {
        if alignment == 0 || !alignment.is_power_of_two() {
            return Err(SlugError::InvalidAlignment(alignment));
        }

        let curves = Section {
            offset: 0,
            length: byte_length(atlas.curves().len(), CURVE_BYTES)?,
        };
        let curve_indices =
            next_section(curves, atlas.curve_indices().len(), INDEX_BYTES, alignment)?;
        let glyphs = next_section(curve_indices, atlas.glyphs().len(), GLYPH_BYTES, alignment)?;
        let bands = next_section(glyphs, atlas.bands().len(), BAND_BYTES, alignment)?;
        let total_length = bands
            .offset
            .checked_add(bands.length)
            .ok_or(SlugError::LengthOverflow)?;

        Ok(Self {
            curves,
            curve_indices,
            glyphs,
            bands,
            total_length,
        })
    }
}

/// Owned, little-endian, alignment-padded GPU atlas bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackedAtlas {
    bytes: Vec<u8>,
    layout: Layout,
}

impl PackedAtlas {
    pub(crate) fn new(atlas: &Atlas, alignment: usize) -> Result<Self, SlugError> {
        let layout = Layout::new(atlas, alignment)?;
        let mut bytes = vec![0; layout.total_length];

        let mut offset = layout.curves.offset;
        for curve in atlas.curves() {
            for value in [
                curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y,
            ] {
                write(&mut bytes, &mut offset, &value.to_le_bytes());
            }
        }

        offset = layout.curve_indices.offset;
        for index in atlas.curve_indices() {
            write(&mut bytes, &mut offset, &index.to_le_bytes());
        }

        offset = layout.glyphs.offset;
        for glyph in atlas.glyphs() {
            for value in [
                glyph.bounds.min_x,
                glyph.bounds.min_y,
                glyph.bounds.max_x,
                glyph.bounds.max_y,
            ] {
                write(&mut bytes, &mut offset, &value.to_le_bytes());
            }
            for value in [
                glyph.curve_start,
                glyph.curve_count,
                glyph.band_start,
                glyph.band_count,
            ] {
                write(&mut bytes, &mut offset, &value.to_le_bytes());
            }
        }

        offset = layout.bands.offset;
        for band in atlas.bands() {
            write(&mut bytes, &mut offset, &band.start.to_le_bytes());
            write(&mut bytes, &mut offset, &band.count.to_le_bytes());
        }

        Ok(Self { bytes, layout })
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn layout(&self) -> Layout {
        self.layout
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

fn next_section(
    previous: Section,
    count: usize,
    stride: usize,
    alignment: usize,
) -> Result<Section, SlugError> {
    let previous_end = previous
        .offset
        .checked_add(previous.length)
        .ok_or(SlugError::LengthOverflow)?;

    Ok(Section {
        offset: align(previous_end, alignment)?,
        length: byte_length(count, stride)?,
    })
}

fn align(value: usize, alignment: usize) -> Result<usize, SlugError> {
    value
        .checked_add(alignment - 1)
        .map(|value| value & !(alignment - 1))
        .ok_or(SlugError::LengthOverflow)
}

fn byte_length(count: usize, stride: usize) -> Result<usize, SlugError> {
    count.checked_mul(stride).ok_or(SlugError::LengthOverflow)
}

fn write(target: &mut [u8], offset: &mut usize, value: &[u8]) {
    let end = *offset + value.len();
    target[*offset..end].copy_from_slice(value);
    *offset = end;
}
