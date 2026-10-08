//! A 3×5 bitmap face for row labels.
//!
//! Labels must not depend on the font being proofed, which may not draw
//! digits yet, and the renderers carry no UI font. Ported from Andrea
//! Fomera's `shift proof` prototype.

/// Pixels per bitmap cell.
pub const LABEL_PIXEL: f32 = 2.0;
/// Horizontal distance between label characters, in pixels.
pub const LABEL_ADVANCE: f32 = 4.0 * LABEL_PIXEL;
/// Label height, in pixels.
pub const LABEL_HEIGHT: f32 = 5.0 * LABEL_PIXEL;

/// The filled cells of `character` as `(column, row)` pairs, row 0 on top;
/// characters outside `0-9`, `.`, and `-` draw nothing.
pub fn cells(character: char) -> impl Iterator<Item = (u8, u8)> {
    let rows: [u8; 5] = match character {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '.' => [0b000, 0b000, 0b000, 0b000, 0b010],
        '-' => [0b000, 0b000, 0b111, 0b000, 0b000],
        _ => [0; 5],
    };
    (0..5u8).flat_map(move |row| {
        (0..3u8)
            .filter(move |column| rows[row as usize] & (0b100 >> column) != 0)
            .map(move |column| (column, row))
    })
}
