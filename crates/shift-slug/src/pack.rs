use crate::{Atlas, Glyph, SlugError};

const CURVE_BYTES: usize = 24;
const WIDE_INDEX_BYTES: usize = 4;
const PACKED_INDEX_WORD_BYTES: usize = 4;
const GLYPH_BYTES: usize = 32;
const BAND_BYTES: usize = 8;

/// Encoding used by the shader-visible curve-index section.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum CurveIndexEncoding {
    /// One global `u32` curve index per array element.
    #[default]
    GlobalU32,
    /// Two glyph-local `u16` curve indexes packed into each `u32` word.
    GlyphLocalU16,
}

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
    pub(crate) fn new(
        atlas: &Atlas,
        alignment: usize,
        index_encoding: CurveIndexEncoding,
    ) -> Result<Self, SlugError> {
        if alignment == 0 || !alignment.is_power_of_two() {
            return Err(SlugError::InvalidAlignment(alignment));
        }
        if index_encoding == CurveIndexEncoding::GlyphLocalU16 {
            validate_compact_eligibility(atlas)?;
        }

        let curves = Section {
            offset: 0,
            length: byte_length(atlas.curves().len(), CURVE_BYTES)?,
        };
        let index_length = index_byte_length(atlas.curve_indices().len(), index_encoding)?;
        let curve_indices = next_section_with_length(curves, index_length, alignment)?;
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
    index_encoding: CurveIndexEncoding,
}

impl PackedAtlas {
    pub(crate) fn new(
        atlas: &Atlas,
        alignment: usize,
        index_encoding: CurveIndexEncoding,
    ) -> Result<Self, SlugError> {
        let layout = Layout::new(atlas, alignment, index_encoding)?;
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
        match index_encoding {
            CurveIndexEncoding::GlobalU32 => {
                for index in atlas.curve_indices() {
                    write(&mut bytes, &mut offset, &index.to_le_bytes());
                }
            }
            CurveIndexEncoding::GlyphLocalU16 => {
                write_compact_indices(atlas, &mut bytes, &mut offset)?;
            }
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

        Ok(Self {
            bytes,
            layout,
            index_encoding,
        })
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn layout(&self) -> Layout {
        self.layout
    }

    pub fn index_encoding(&self) -> CurveIndexEncoding {
        self.index_encoding
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

fn validate_compact_eligibility(atlas: &Atlas) -> Result<(), SlugError> {
    for (glyph_index, glyph) in atlas.glyphs().iter().enumerate() {
        if glyph.curve_count > u32::from(u16::MAX) + 1 {
            return Err(SlugError::CompactIndexOverflow {
                glyph_index: u32::try_from(glyph_index).map_err(|_| SlugError::LengthOverflow)?,
                curve_count: glyph.curve_count,
            });
        }
    }
    Ok(())
}

fn write_compact_indices(
    atlas: &Atlas,
    target: &mut [u8],
    offset: &mut usize,
) -> Result<(), SlugError> {
    let mut processed = 0_usize;
    let mut pending_low = None;

    for (glyph_index, glyph) in atlas.glyphs().iter().copied().enumerate() {
        let glyph_index = u32::try_from(glyph_index).map_err(|_| SlugError::LengthOverflow)?;
        if glyph.curve_count > u32::from(u16::MAX) + 1 {
            return Err(SlugError::CompactIndexOverflow {
                glyph_index,
                curve_count: glyph.curve_count,
            });
        }
        let (start, end) = glyph_index_range(atlas, glyph)?;
        if start != processed {
            return Err(SlugError::LengthOverflow);
        }

        let curve_end = glyph
            .curve_start
            .checked_add(glyph.curve_count)
            .ok_or(SlugError::LengthOverflow)?;
        for global_index in &atlas.curve_indices()[start..end] {
            if *global_index < glyph.curve_start || *global_index >= curve_end {
                return Err(SlugError::LengthOverflow);
            }
            let local_index = u16::try_from(*global_index - glyph.curve_start).map_err(|_| {
                SlugError::CompactIndexOverflow {
                    glyph_index,
                    curve_count: glyph.curve_count,
                }
            })?;
            if let Some(low) = pending_low.take() {
                let word = u32::from(low) | (u32::from(local_index) << 16);
                write(target, offset, &word.to_le_bytes());
            } else {
                pending_low = Some(local_index);
            }
        }
        processed = end;
    }

    if processed != atlas.curve_indices().len() {
        return Err(SlugError::LengthOverflow);
    }
    if let Some(low) = pending_low {
        write(target, offset, &u32::from(low).to_le_bytes());
    }
    Ok(())
}

fn glyph_index_range(atlas: &Atlas, glyph: Glyph) -> Result<(usize, usize), SlugError> {
    let band_start = usize::try_from(glyph.band_start).map_err(|_| SlugError::LengthOverflow)?;
    let band_length = usize::try_from(glyph.band_count)
        .map_err(|_| SlugError::LengthOverflow)?
        .checked_mul(2)
        .ok_or(SlugError::LengthOverflow)?;
    let band_end = band_start
        .checked_add(band_length)
        .ok_or(SlugError::LengthOverflow)?;
    let glyph_bands = atlas
        .bands()
        .get(band_start..band_end)
        .ok_or(SlugError::LengthOverflow)?;
    let first = glyph_bands.first().ok_or(SlugError::LengthOverflow)?;
    let last = glyph_bands.last().ok_or(SlugError::LengthOverflow)?;
    let start = usize::try_from(first.start).map_err(|_| SlugError::LengthOverflow)?;
    let end = usize::try_from(
        last.start
            .checked_add(last.count)
            .ok_or(SlugError::LengthOverflow)?,
    )
    .map_err(|_| SlugError::LengthOverflow)?;
    if end > atlas.curve_indices().len() {
        return Err(SlugError::LengthOverflow);
    }
    Ok((start, end))
}

fn index_byte_length(count: usize, encoding: CurveIndexEncoding) -> Result<usize, SlugError> {
    match encoding {
        CurveIndexEncoding::GlobalU32 => byte_length(count, WIDE_INDEX_BYTES),
        CurveIndexEncoding::GlyphLocalU16 => {
            let words = count.checked_add(1).ok_or(SlugError::LengthOverflow)? / 2;
            byte_length(words, PACKED_INDEX_WORD_BYTES)
        }
    }
}

fn next_section(
    previous: Section,
    count: usize,
    stride: usize,
    alignment: usize,
) -> Result<Section, SlugError> {
    next_section_with_length(previous, byte_length(count, stride)?, alignment)
}

fn next_section_with_length(
    previous: Section,
    length: usize,
    alignment: usize,
) -> Result<Section, SlugError> {
    let previous_end = previous
        .offset
        .checked_add(previous.length)
        .ok_or(SlugError::LengthOverflow)?;

    Ok(Section {
        offset: align(previous_end, alignment)?,
        length,
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
