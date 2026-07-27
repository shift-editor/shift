use std::collections::{BTreeMap, HashMap, HashSet};
use std::{error::Error, fmt};

const MAGIC: &[u8; 4] = b"SHFT";
const LAYER_KIND: u8 = 0x02;
const LAYER_VERSION: u8 = 0x01;
const HEADER_LEN: usize = 72;
const NONE_STRING: u32 = u32::MAX;
const CONTOUR_LEN: usize = 12;
const POINT_LEN: usize = 24;
const COMPONENT_LEN: usize = 88;
const ANCHOR_LEN: usize = 24;
const GUIDELINE_LEN: usize = 40;

/// Maximum contour count accepted by `shift.glyph-layer.v1`.
pub const MAX_LAYER_CONTOUR_COUNT: usize = 1_000_000;
/// Maximum point count accepted by `shift.glyph-layer.v1`.
pub const MAX_LAYER_POINT_COUNT: usize = 4_000_000;
/// Maximum count accepted for each other top-level layer entity kind.
pub const MAX_LAYER_ENTITY_COUNT: usize = 1_000_000;
/// Maximum number of distinct strings accepted by one layer payload.
pub const MAX_LAYER_STRING_COUNT: usize = 4_000_000;
/// Maximum combined UTF-8 string bytes accepted by one layer payload.
pub const MAX_LAYER_STRING_BYTES: usize = 64 * 1024 * 1024;
/// Maximum nested lib values accepted by one layer payload.
pub const MAX_LAYER_LIB_VALUES: usize = 1_000_000;
/// Maximum lib array/dictionary nesting depth.
pub const MAX_LAYER_LIB_DEPTH: usize = 64;
/// Maximum total encoded layer payload size.
pub const MAX_LAYER_PAYLOAD_BYTES: usize = 256 * 1024 * 1024;

/// Codec-owned point semantics. Numeric discriminants are part of layer v1.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayerPointType {
    OnCurve,
    OffCurve,
    QCurve,
}

impl LayerPointType {
    fn byte(self) -> u8 {
        match self {
            Self::OnCurve => 0,
            Self::OffCurve => 1,
            Self::QCurve => 2,
        }
    }

    fn from_byte(value: u8, index: usize) -> Result<Self, LayerCodecError> {
        match value {
            0 => Ok(Self::OnCurve),
            1 => Ok(Self::OffCurve),
            2 => Ok(Self::QCurve),
            value => Err(LayerCodecError::UnknownPointType { index, value }),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LayerPoint {
    pub id: String,
    pub point_type: LayerPointType,
    pub smooth: bool,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LayerContour {
    pub id: String,
    pub closed: bool,
    pub points: Vec<LayerPoint>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayerTransform {
    pub translate_x: f64,
    pub translate_y: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub skew_x: f64,
    pub skew_y: f64,
    pub center_x: f64,
    pub center_y: f64,
}

impl Default for LayerTransform {
    fn default() -> Self {
        Self {
            translate_x: 0.0,
            translate_y: 0.0,
            rotation: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            skew_x: 0.0,
            skew_y: 0.0,
            center_x: 0.0,
            center_y: 0.0,
        }
    }
}

impl LayerTransform {
    fn values(self) -> [f64; 9] {
        [
            self.translate_x,
            self.translate_y,
            self.rotation,
            self.scale_x,
            self.scale_y,
            self.skew_x,
            self.skew_y,
            self.center_x,
            self.center_y,
        ]
    }

    fn from_values(values: [f64; 9]) -> Self {
        Self {
            translate_x: values[0],
            translate_y: values[1],
            rotation: values[2],
            scale_x: values[3],
            scale_y: values[4],
            skew_x: values[5],
            skew_y: values[6],
            center_x: values[7],
            center_y: values[8],
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LayerComponent {
    pub id: String,
    pub base_glyph_id: String,
    pub base_glyph_name: String,
    pub transform: LayerTransform,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LayerAnchor {
    pub id: String,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LayerGuideline {
    pub id: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub angle: Option<f64>,
    pub name: Option<String>,
    pub color: Option<String>,
}

/// Lossless values supported by authored layer lib dictionaries.
#[derive(Clone, Debug, PartialEq)]
pub enum LayerLibValue {
    String(String),
    Integer(i64),
    UnsignedInteger(u64),
    Float(f64),
    Boolean(bool),
    Array(Vec<LayerLibValue>),
    Dict(BTreeMap<String, LayerLibValue>),
    Data(Vec<u8>),
    Date(String),
    Uid(u64),
}

/// Codec-owned complete authored layer input/output.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphLayer {
    pub id: String,
    pub source_id: String,
    pub width: f64,
    pub height: Option<f64>,
    pub contours: Vec<LayerContour>,
    pub components: Vec<LayerComponent>,
    pub anchors: Vec<LayerAnchor>,
    pub guidelines: Vec<LayerGuideline>,
    pub lib: BTreeMap<String, LayerLibValue>,
}

impl GlyphLayer {
    pub fn empty(id: impl Into<String>, source_id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            source_id: source_id.into(),
            width: 0.0,
            height: None,
            contours: Vec::new(),
            components: Vec::new(),
            anchors: Vec::new(),
            guidelines: Vec::new(),
            lib: BTreeMap::new(),
        }
    }
}

/// Strict authored-layer codec failure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LayerCodecError {
    HeaderTruncated {
        actual: usize,
    },
    WrongMagic,
    UnsupportedPayloadKind(u8),
    UnsupportedVersion(u8),
    UnknownFlags(u16),
    UnknownLayerFlags(u32),
    UnknownRecordFlags {
        record: &'static str,
        index: usize,
        flags: u32,
    },
    NonZeroReserved {
        record: &'static str,
        index: usize,
    },
    UnknownPointType {
        index: usize,
        value: u8,
    },
    UnknownLibTag {
        offset: usize,
        value: u8,
    },
    InvalidBoolean {
        offset: usize,
        value: u8,
    },
    InvalidUtf8 {
        index: usize,
    },
    InvalidStringOffsets {
        index: usize,
    },
    DuplicateString {
        index: usize,
    },
    StringReferenceOutOfRange {
        index: u32,
    },
    NonCanonicalStringReference {
        expected_at_most: u32,
        actual: u32,
    },
    UnreferencedStrings {
        first: u32,
    },
    DuplicateIdentity {
        kind: &'static str,
        index: usize,
    },
    NonCanonicalMapOrder {
        offset: usize,
    },
    NonFiniteNumber {
        field: &'static str,
        index: usize,
    },
    NonCanonicalAbsentNumber {
        field: &'static str,
        index: usize,
    },
    PointCountMismatch {
        expected: usize,
        actual: usize,
    },
    LibLengthMismatch {
        expected: usize,
        actual: usize,
    },
    NestingLimitExceeded {
        limit: usize,
    },
    Truncated {
        offset: usize,
        needed: usize,
        available: usize,
    },
    LengthOverflow,
    LengthMismatch {
        expected: usize,
        actual: usize,
    },
    LimitExceeded {
        field: &'static str,
        limit: usize,
        actual: usize,
    },
}

impl fmt::Display for LayerCodecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HeaderTruncated { actual } => write!(formatter, "glyph-layer header is truncated: {actual} of {HEADER_LEN} bytes"),
            Self::WrongMagic => formatter.write_str("wrong glyph-codec magic"),
            Self::UnsupportedPayloadKind(kind) => write!(formatter, "unsupported glyph-codec payload kind {kind:#04x}"),
            Self::UnsupportedVersion(version) => write!(formatter, "unsupported glyph-layer version {version}"),
            Self::UnknownFlags(flags) => write!(formatter, "unknown glyph-layer frame flags {flags:#06x}"),
            Self::UnknownLayerFlags(flags) => write!(formatter, "unknown glyph-layer flags {flags:#010x}"),
            Self::UnknownRecordFlags { record, index, flags } => write!(formatter, "unknown {record} flags {flags:#010x} at index {index}"),
            Self::NonZeroReserved { record, index } => write!(formatter, "non-zero reserved {record} bytes at index {index}"),
            Self::UnknownPointType { index, value } => write!(formatter, "unknown point type {value:#04x} at index {index}"),
            Self::UnknownLibTag { offset, value } => write!(formatter, "unknown lib value tag {value:#04x} at byte {offset}"),
            Self::InvalidBoolean { offset, value } => write!(formatter, "invalid boolean {value} at byte {offset}"),
            Self::InvalidUtf8 { index } => write!(formatter, "invalid UTF-8 in string {index}"),
            Self::InvalidStringOffsets { index } => write!(formatter, "non-canonical string offsets at index {index}"),
            Self::DuplicateString { index } => write!(formatter, "duplicate string-table value at index {index}"),
            Self::StringReferenceOutOfRange { index } => write!(formatter, "string reference {index} is out of range"),
            Self::NonCanonicalStringReference { expected_at_most, actual } => write!(formatter, "string reference {actual} is out of canonical first-use order; expected at most {expected_at_most}"),
            Self::UnreferencedStrings { first } => write!(formatter, "string table has unreferenced entries beginning at index {first}"),
            Self::DuplicateIdentity { kind, index } => write!(formatter, "duplicate {kind} identity at index {index}"),
            Self::NonCanonicalMapOrder { offset } => write!(formatter, "dictionary keys are not in canonical UTF-8 order at byte {offset}"),
            Self::NonFiniteNumber { field, index } => write!(formatter, "non-finite {field} value at index {index}"),
            Self::NonCanonicalAbsentNumber { field, index } => write!(formatter, "absent {field} value at index {index} is not canonical positive zero"),
            Self::PointCountMismatch { expected, actual } => write!(formatter, "contours contain {actual} points, header declares {expected}"),
            Self::LibLengthMismatch { expected, actual } => write!(formatter, "layer lib length mismatch: expected {expected} bytes, consumed {actual}"),
            Self::NestingLimitExceeded { limit } => write!(formatter, "layer lib nesting exceeds implementation limit {limit}"),
            Self::Truncated { offset, needed, available } => write!(formatter, "glyph-layer body is truncated at byte {offset}: need {needed} bytes, have {available}"),
            Self::LengthOverflow => formatter.write_str("glyph-layer payload length arithmetic overflowed"),
            Self::LengthMismatch { expected, actual } => write!(formatter, "glyph-layer payload length mismatch: expected {expected} bytes, got {actual}"),
            Self::LimitExceeded { field, limit, actual } => write!(formatter, "glyph-layer {field} exceeds implementation limit {limit}: got {actual}"),
        }
    }
}

impl Error for LayerCodecError {}

/// Owned canonical `shift.glyph-layer.v1` bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackedGlyphLayer(Vec<u8>);

impl PackedGlyphLayer {
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, LayerCodecError> {
        decode_layer(&bytes)?;
        Ok(Self(bytes))
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }

    pub fn view(&self) -> GlyphLayerView<'_> {
        decode_layer(&self.0).expect("PackedGlyphLayer invariant violated")
    }

    pub fn unpack(&self) -> GlyphLayer {
        self.view().unpack()
    }
}

#[derive(Clone, Copy, Debug)]
struct Strings<'a> {
    bytes: &'a [u8],
    count: usize,
    offsets_offset: usize,
    values_offset: usize,
}

impl<'a> Strings<'a> {
    fn get(self, index: u32) -> &'a str {
        let index = index as usize;
        debug_assert!(index < self.count);
        let start = read_u32(self.bytes, self.offsets_offset + index * 4) as usize;
        let end = read_u32(self.bytes, self.offsets_offset + (index + 1) * 4) as usize;
        std::str::from_utf8(&self.bytes[self.values_offset + start..self.values_offset + end])
            .expect("validated UTF-8")
    }
}

/// Validated allocation-free access to an authored layer payload.
#[derive(Clone, Copy, Debug)]
pub struct GlyphLayerView<'a> {
    bytes: &'a [u8],
    strings: Strings<'a>,
    id_index: u32,
    source_id_index: u32,
    width: f64,
    height: Option<f64>,
    contour_count: usize,
    point_count: usize,
    component_count: usize,
    anchor_count: usize,
    guideline_count: usize,
    contours_offset: usize,
    components_offset: usize,
    anchors_offset: usize,
    guidelines_offset: usize,
    lib_offset: usize,
    lib_end: usize,
}

impl<'a> GlyphLayerView<'a> {
    pub fn id(self) -> &'a str {
        self.strings.get(self.id_index)
    }
    pub fn source_id(self) -> &'a str {
        self.strings.get(self.source_id_index)
    }
    pub fn width(self) -> f64 {
        self.width
    }
    pub fn height(self) -> Option<f64> {
        self.height
    }
    pub fn contour_count(self) -> usize {
        self.contour_count
    }
    pub fn point_count(self) -> usize {
        self.point_count
    }
    pub fn component_count(self) -> usize {
        self.component_count
    }
    pub fn anchor_count(self) -> usize {
        self.anchor_count
    }
    pub fn guideline_count(self) -> usize {
        self.guideline_count
    }

    /// Streams contours; each contour streams its points directly from bytes.
    pub fn contours(self) -> LayerContourIter<'a> {
        LayerContourIter {
            bytes: self.bytes,
            strings: self.strings,
            offset: self.contours_offset,
            remaining: self.contour_count,
        }
    }

    pub fn components(self) -> LayerComponentIter<'a> {
        LayerComponentIter {
            bytes: self.bytes,
            strings: self.strings,
            offset: self.components_offset,
            remaining: self.component_count,
            index: 0,
        }
    }

    pub fn anchors(self) -> LayerAnchorIter<'a> {
        LayerAnchorIter {
            bytes: self.bytes,
            strings: self.strings,
            offset: self.anchors_offset,
            remaining: self.anchor_count,
        }
    }

    pub fn guidelines(self) -> LayerGuidelineIter<'a> {
        LayerGuidelineIter {
            bytes: self.bytes,
            strings: self.strings,
            offset: self.guidelines_offset,
            remaining: self.guideline_count,
        }
    }

    pub fn lib(self) -> BTreeMap<String, LayerLibValue> {
        let mut cursor = Cursor::with_range(self.bytes, self.lib_offset, self.lib_end);
        let mut state = DecodeState::for_validated(self.strings);
        decode_map(&mut cursor, &mut state, 0).expect("validated layer lib")
    }

    /// Materializes exactly one editable layer, never a complete font.
    pub fn unpack(self) -> GlyphLayer {
        GlyphLayer {
            id: self.id().to_owned(),
            source_id: self.source_id().to_owned(),
            width: self.width,
            height: self.height,
            contours: self.contours().map(LayerContourView::unpack).collect(),
            components: self.components().map(LayerComponentView::unpack).collect(),
            anchors: self.anchors().map(LayerAnchorView::unpack).collect(),
            guidelines: self.guidelines().map(LayerGuidelineView::unpack).collect(),
            lib: self.lib(),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct LayerContourView<'a> {
    bytes: &'a [u8],
    strings: Strings<'a>,
    id_index: u32,
    closed: bool,
    point_count: usize,
    points_offset: usize,
}

impl<'a> LayerContourView<'a> {
    pub fn id(self) -> &'a str {
        self.strings.get(self.id_index)
    }
    pub fn closed(self) -> bool {
        self.closed
    }
    pub fn point_count(self) -> usize {
        self.point_count
    }
    pub fn points(self) -> LayerPointIter<'a> {
        LayerPointIter {
            bytes: self.bytes,
            strings: self.strings,
            offset: self.points_offset,
            remaining: self.point_count,
        }
    }
    fn unpack(self) -> LayerContour {
        LayerContour {
            id: self.id().to_owned(),
            closed: self.closed,
            points: self.points().map(LayerPointView::unpack).collect(),
        }
    }
}

pub struct LayerContourIter<'a> {
    bytes: &'a [u8],
    strings: Strings<'a>,
    offset: usize,
    remaining: usize,
}

impl<'a> Iterator for LayerContourIter<'a> {
    type Item = LayerContourView<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let id_index = read_u32(self.bytes, self.offset);
        let point_count = read_u32(self.bytes, self.offset + 4) as usize;
        let closed = read_u32(self.bytes, self.offset + 8) & 1 != 0;
        let points_offset = self.offset + CONTOUR_LEN;
        self.offset = points_offset + point_count * POINT_LEN;
        self.remaining -= 1;
        Some(LayerContourView {
            bytes: self.bytes,
            strings: self.strings,
            id_index,
            closed,
            point_count,
            points_offset,
        })
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}
impl ExactSizeIterator for LayerContourIter<'_> {}

#[derive(Clone, Copy, Debug)]
pub struct LayerPointView<'a> {
    id: &'a str,
    point_type: LayerPointType,
    smooth: bool,
    x: f64,
    y: f64,
}
impl<'a> LayerPointView<'a> {
    pub fn id(self) -> &'a str {
        self.id
    }
    pub fn point_type(self) -> LayerPointType {
        self.point_type
    }
    pub fn smooth(self) -> bool {
        self.smooth
    }
    pub fn x(self) -> f64 {
        self.x
    }
    pub fn y(self) -> f64 {
        self.y
    }
    fn unpack(self) -> LayerPoint {
        LayerPoint {
            id: self.id.to_owned(),
            point_type: self.point_type,
            smooth: self.smooth,
            x: self.x,
            y: self.y,
        }
    }
}

pub struct LayerPointIter<'a> {
    bytes: &'a [u8],
    strings: Strings<'a>,
    offset: usize,
    remaining: usize,
}
impl<'a> Iterator for LayerPointIter<'a> {
    type Item = LayerPointView<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let index = read_u32(self.bytes, self.offset);
        let point_type = match self.bytes[self.offset + 4] {
            0 => LayerPointType::OnCurve,
            1 => LayerPointType::OffCurve,
            2 => LayerPointType::QCurve,
            _ => unreachable!("validated point type"),
        };
        let smooth = self.bytes[self.offset + 5] & 1 != 0;
        let x = read_f64(self.bytes, self.offset + 8);
        let y = read_f64(self.bytes, self.offset + 16);
        self.offset += POINT_LEN;
        self.remaining -= 1;
        Some(LayerPointView {
            id: self.strings.get(index),
            point_type,
            smooth,
            x,
            y,
        })
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}
impl ExactSizeIterator for LayerPointIter<'_> {}

#[derive(Clone, Copy, Debug)]
pub struct LayerComponentView<'a> {
    id: &'a str,
    base_glyph_id: &'a str,
    base_glyph_name: &'a str,
    transform: LayerTransform,
}
impl<'a> LayerComponentView<'a> {
    pub fn id(self) -> &'a str {
        self.id
    }
    pub fn base_glyph_id(self) -> &'a str {
        self.base_glyph_id
    }
    pub fn base_glyph_name(self) -> &'a str {
        self.base_glyph_name
    }
    pub fn transform(self) -> LayerTransform {
        self.transform
    }
    fn unpack(self) -> LayerComponent {
        LayerComponent {
            id: self.id.to_owned(),
            base_glyph_id: self.base_glyph_id.to_owned(),
            base_glyph_name: self.base_glyph_name.to_owned(),
            transform: self.transform,
        }
    }
}
pub struct LayerComponentIter<'a> {
    bytes: &'a [u8],
    strings: Strings<'a>,
    offset: usize,
    remaining: usize,
    index: usize,
}
impl<'a> Iterator for LayerComponentIter<'a> {
    type Item = LayerComponentView<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let id = self.strings.get(read_u32(self.bytes, self.offset));
        let base_glyph_id = self.strings.get(read_u32(self.bytes, self.offset + 4));
        let base_glyph_name = self.strings.get(read_u32(self.bytes, self.offset + 8));
        let mut values = [0.0; 9];
        for (value_index, value) in values.iter_mut().enumerate() {
            *value = read_f64(self.bytes, self.offset + 16 + value_index * 8);
        }
        self.offset += COMPONENT_LEN;
        self.remaining -= 1;
        self.index += 1;
        Some(LayerComponentView {
            id,
            base_glyph_id,
            base_glyph_name,
            transform: LayerTransform::from_values(values),
        })
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}
impl ExactSizeIterator for LayerComponentIter<'_> {}

#[derive(Clone, Copy, Debug)]
pub struct LayerAnchorView<'a> {
    id: &'a str,
    name: Option<&'a str>,
    x: f64,
    y: f64,
}
impl<'a> LayerAnchorView<'a> {
    pub fn id(self) -> &'a str {
        self.id
    }
    pub fn name(self) -> Option<&'a str> {
        self.name
    }
    pub fn x(self) -> f64 {
        self.x
    }
    pub fn y(self) -> f64 {
        self.y
    }
    fn unpack(self) -> LayerAnchor {
        LayerAnchor {
            id: self.id.to_owned(),
            name: self.name.map(str::to_owned),
            x: self.x,
            y: self.y,
        }
    }
}
pub struct LayerAnchorIter<'a> {
    bytes: &'a [u8],
    strings: Strings<'a>,
    offset: usize,
    remaining: usize,
}
impl<'a> Iterator for LayerAnchorIter<'a> {
    type Item = LayerAnchorView<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let id = self.strings.get(read_u32(self.bytes, self.offset));
        let name = optional_string(self.strings, read_u32(self.bytes, self.offset + 4));
        let x = read_f64(self.bytes, self.offset + 8);
        let y = read_f64(self.bytes, self.offset + 16);
        self.offset += ANCHOR_LEN;
        self.remaining -= 1;
        Some(LayerAnchorView { id, name, x, y })
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}
impl ExactSizeIterator for LayerAnchorIter<'_> {}

#[derive(Clone, Copy, Debug)]
pub struct LayerGuidelineView<'a> {
    id: &'a str,
    x: Option<f64>,
    y: Option<f64>,
    angle: Option<f64>,
    name: Option<&'a str>,
    color: Option<&'a str>,
}
impl<'a> LayerGuidelineView<'a> {
    pub fn id(self) -> &'a str {
        self.id
    }
    pub fn x(self) -> Option<f64> {
        self.x
    }
    pub fn y(self) -> Option<f64> {
        self.y
    }
    pub fn angle(self) -> Option<f64> {
        self.angle
    }
    pub fn name(self) -> Option<&'a str> {
        self.name
    }
    pub fn color(self) -> Option<&'a str> {
        self.color
    }
    fn unpack(self) -> LayerGuideline {
        LayerGuideline {
            id: self.id.to_owned(),
            x: self.x,
            y: self.y,
            angle: self.angle,
            name: self.name.map(str::to_owned),
            color: self.color.map(str::to_owned),
        }
    }
}
pub struct LayerGuidelineIter<'a> {
    bytes: &'a [u8],
    strings: Strings<'a>,
    offset: usize,
    remaining: usize,
}
impl<'a> Iterator for LayerGuidelineIter<'a> {
    type Item = LayerGuidelineView<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let id = self.strings.get(read_u32(self.bytes, self.offset));
        let name = optional_string(self.strings, read_u32(self.bytes, self.offset + 4));
        let color = optional_string(self.strings, read_u32(self.bytes, self.offset + 8));
        let flags = read_u32(self.bytes, self.offset + 12);
        let raw = [
            read_f64(self.bytes, self.offset + 16),
            read_f64(self.bytes, self.offset + 24),
            read_f64(self.bytes, self.offset + 32),
        ];
        self.offset += GUIDELINE_LEN;
        self.remaining -= 1;
        Some(LayerGuidelineView {
            id,
            name,
            color,
            x: (flags & 1 != 0).then_some(raw[0]),
            y: (flags & 2 != 0).then_some(raw[1]),
            angle: (flags & 4 != 0).then_some(raw[2]),
        })
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}
impl ExactSizeIterator for LayerGuidelineIter<'_> {}

fn optional_string<'a>(strings: Strings<'a>, index: u32) -> Option<&'a str> {
    (index != NONE_STRING).then(|| strings.get(index))
}

/// Canonically encodes a complete authored layer.
pub fn pack_layer(layer: &GlyphLayer) -> Result<PackedGlyphLayer, LayerCodecError> {
    check_limit(
        "contour count",
        layer.contours.len(),
        MAX_LAYER_CONTOUR_COUNT,
    )?;
    check_limit(
        "component count",
        layer.components.len(),
        MAX_LAYER_ENTITY_COUNT,
    )?;
    check_limit("anchor count", layer.anchors.len(), MAX_LAYER_ENTITY_COUNT)?;
    check_limit(
        "guideline count",
        layer.guidelines.len(),
        MAX_LAYER_ENTITY_COUNT,
    )?;
    let point_count = layer.contours.iter().try_fold(0usize, |total, contour| {
        total
            .checked_add(contour.points.len())
            .ok_or(LayerCodecError::LengthOverflow)
    })?;
    check_limit("point count", point_count, MAX_LAYER_POINT_COUNT)?;

    let mut strings = StringPool::default();
    strings.intern(&layer.id)?;
    strings.intern(&layer.source_id)?;
    for contour in &layer.contours {
        strings.intern(&contour.id)?;
        for point in &contour.points {
            strings.intern(&point.id)?;
        }
    }
    for component in &layer.components {
        strings.intern(&component.id)?;
        strings.intern(&component.base_glyph_id)?;
        strings.intern(&component.base_glyph_name)?;
    }
    for anchor in &layer.anchors {
        strings.intern(&anchor.id)?;
        if let Some(name) = &anchor.name {
            strings.intern(name)?;
        }
    }
    for guideline in &layer.guidelines {
        strings.intern(&guideline.id)?;
        if let Some(name) = &guideline.name {
            strings.intern(name)?;
        }
        if let Some(color) = &guideline.color {
            strings.intern(color)?;
        }
    }
    gather_map_strings(&layer.lib, &mut strings, 0, &mut 0)?;

    let mut bytes = vec![0; HEADER_LEN];
    let mut running_string_bytes = 0usize;
    push_u32(&mut bytes, 0)?;
    for value in &strings.values {
        running_string_bytes = running_string_bytes
            .checked_add(value.len())
            .ok_or(LayerCodecError::LengthOverflow)?;
        check_limit("string bytes", running_string_bytes, MAX_LAYER_STRING_BYTES)?;
        push_u32(&mut bytes, running_string_bytes)?;
    }
    for value in &strings.values {
        bytes.extend_from_slice(value.as_bytes());
    }

    for contour in &layer.contours {
        push_u32(&mut bytes, strings.index(&contour.id))?;
        push_u32(&mut bytes, contour.points.len())?;
        push_u32(&mut bytes, u32::from(contour.closed))?;
        for point in &contour.points {
            push_u32(&mut bytes, strings.index(&point.id))?;
            bytes.push(point.point_type.byte());
            bytes.push(u8::from(point.smooth));
            bytes.extend_from_slice(&0u16.to_le_bytes());
            bytes.extend_from_slice(&point.x.to_le_bytes());
            bytes.extend_from_slice(&point.y.to_le_bytes());
        }
    }
    for component in &layer.components {
        push_u32(&mut bytes, strings.index(&component.id))?;
        push_u32(&mut bytes, strings.index(&component.base_glyph_id))?;
        push_u32(&mut bytes, strings.index(&component.base_glyph_name))?;
        push_u32(&mut bytes, 0)?;
        for value in component.transform.values() {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    for anchor in &layer.anchors {
        push_u32(&mut bytes, strings.index(&anchor.id))?;
        push_u32(
            &mut bytes,
            anchor
                .name
                .as_ref()
                .map_or(NONE_STRING, |value| strings.index(value)),
        )?;
        bytes.extend_from_slice(&anchor.x.to_le_bytes());
        bytes.extend_from_slice(&anchor.y.to_le_bytes());
    }
    for guideline in &layer.guidelines {
        push_u32(&mut bytes, strings.index(&guideline.id))?;
        push_u32(
            &mut bytes,
            guideline
                .name
                .as_ref()
                .map_or(NONE_STRING, |value| strings.index(value)),
        )?;
        push_u32(
            &mut bytes,
            guideline
                .color
                .as_ref()
                .map_or(NONE_STRING, |value| strings.index(value)),
        )?;
        let flags = u32::from(guideline.x.is_some())
            | (u32::from(guideline.y.is_some()) << 1)
            | (u32::from(guideline.angle.is_some()) << 2);
        push_u32(&mut bytes, flags)?;
        for value in [guideline.x, guideline.y, guideline.angle] {
            bytes.extend_from_slice(&value.unwrap_or(0.0).to_le_bytes());
        }
    }
    let lib_offset = bytes.len();
    encode_map(&mut bytes, &layer.lib, &strings, 0, &mut 0)?;
    let lib_bytes = bytes
        .len()
        .checked_sub(lib_offset)
        .ok_or(LayerCodecError::LengthOverflow)?;
    check_limit("payload byte length", bytes.len(), MAX_LAYER_PAYLOAD_BYTES)?;

    bytes[..4].copy_from_slice(MAGIC);
    bytes[4] = LAYER_KIND;
    bytes[5] = LAYER_VERSION;
    write_u16(&mut bytes, 6, 0);
    let payload_len = bytes.len();
    write_u32(&mut bytes, 8, payload_len)?;
    write_u32(&mut bytes, 12, strings.values.len())?;
    write_u32(&mut bytes, 16, running_string_bytes)?;
    write_u32(&mut bytes, 20, layer.contours.len())?;
    write_u32(&mut bytes, 24, point_count)?;
    write_u32(&mut bytes, 28, layer.components.len())?;
    write_u32(&mut bytes, 32, layer.anchors.len())?;
    write_u32(&mut bytes, 36, layer.guidelines.len())?;
    write_u32(&mut bytes, 40, lib_bytes)?;
    write_u32(&mut bytes, 44, strings.index(&layer.id))?;
    write_u32(&mut bytes, 48, strings.index(&layer.source_id))?;
    write_u32(&mut bytes, 52, u32::from(layer.height.is_some()))?;
    bytes[56..64].copy_from_slice(&layer.width.to_le_bytes());
    bytes[64..72].copy_from_slice(&layer.height.unwrap_or(0.0).to_le_bytes());

    decode_layer(&bytes)?;
    Ok(PackedGlyphLayer(bytes))
}

/// Strictly validates one canonical authored layer and returns borrowed streams.
pub fn decode_layer(bytes: &[u8]) -> Result<GlyphLayerView<'_>, LayerCodecError> {
    if bytes.len() < HEADER_LEN {
        return Err(LayerCodecError::HeaderTruncated {
            actual: bytes.len(),
        });
    }
    check_limit("payload byte length", bytes.len(), MAX_LAYER_PAYLOAD_BYTES)?;
    if &bytes[..4] != MAGIC {
        return Err(LayerCodecError::WrongMagic);
    }
    if bytes[4] != LAYER_KIND {
        return Err(LayerCodecError::UnsupportedPayloadKind(bytes[4]));
    }
    if bytes[5] != LAYER_VERSION {
        return Err(LayerCodecError::UnsupportedVersion(bytes[5]));
    }
    let frame_flags = read_u16(bytes, 6);
    if frame_flags != 0 {
        return Err(LayerCodecError::UnknownFlags(frame_flags));
    }
    let declared_len = read_u32(bytes, 8) as usize;
    if declared_len != bytes.len() {
        return Err(LayerCodecError::LengthMismatch {
            expected: declared_len,
            actual: bytes.len(),
        });
    }

    let string_count = read_u32(bytes, 12) as usize;
    let string_bytes = read_u32(bytes, 16) as usize;
    let contour_count = read_u32(bytes, 20) as usize;
    let point_count = read_u32(bytes, 24) as usize;
    let component_count = read_u32(bytes, 28) as usize;
    let anchor_count = read_u32(bytes, 32) as usize;
    let guideline_count = read_u32(bytes, 36) as usize;
    let lib_bytes = read_u32(bytes, 40) as usize;
    let id_index = read_u32(bytes, 44);
    let source_id_index = read_u32(bytes, 48);
    let layer_flags = read_u32(bytes, 52);
    if layer_flags & !1 != 0 {
        return Err(LayerCodecError::UnknownLayerFlags(layer_flags));
    }
    let width = read_f64(bytes, 56);
    validate_finite(width, "width", 0)?;
    let raw_height = read_f64(bytes, 64);
    let height = if layer_flags & 1 != 0 {
        validate_finite(raw_height, "height", 0)?;
        Some(raw_height)
    } else {
        validate_absent(raw_height, "height", 0)?;
        None
    };

    check_limit("string count", string_count, MAX_LAYER_STRING_COUNT)?;
    check_limit("string bytes", string_bytes, MAX_LAYER_STRING_BYTES)?;
    check_limit("contour count", contour_count, MAX_LAYER_CONTOUR_COUNT)?;
    check_limit("point count", point_count, MAX_LAYER_POINT_COUNT)?;
    check_limit("component count", component_count, MAX_LAYER_ENTITY_COUNT)?;
    check_limit("anchor count", anchor_count, MAX_LAYER_ENTITY_COUNT)?;
    check_limit("guideline count", guideline_count, MAX_LAYER_ENTITY_COUNT)?;

    let offsets_len = string_count
        .checked_add(1)
        .and_then(|count| count.checked_mul(4))
        .ok_or(LayerCodecError::LengthOverflow)?;
    let values_offset = HEADER_LEN
        .checked_add(offsets_len)
        .ok_or(LayerCodecError::LengthOverflow)?;
    let strings_end = values_offset
        .checked_add(string_bytes)
        .ok_or(LayerCodecError::LengthOverflow)?;
    require_range(
        bytes,
        HEADER_LEN,
        offsets_len
            .checked_add(string_bytes)
            .ok_or(LayerCodecError::LengthOverflow)?,
    )?;
    let strings = Strings {
        bytes,
        count: string_count,
        offsets_offset: HEADER_LEN,
        values_offset,
    };
    validate_strings(strings, string_bytes)?;

    let mut state = DecodeState::new(strings);
    state.reference(id_index)?;
    state.reference(source_id_index)?;
    let mut cursor = Cursor::with_range(bytes, strings_end, bytes.len());
    let contours_offset = cursor.offset;
    let mut actual_points = 0usize;
    for contour_index in 0..contour_count {
        let contour_id = state.required_string(cursor.u32()?)?;
        state.unique_identity("contour", contour_index, contour_id)?;
        let count = cursor.u32()? as usize;
        actual_points = actual_points
            .checked_add(count)
            .ok_or(LayerCodecError::LengthOverflow)?;
        check_limit("point count", actual_points, MAX_LAYER_POINT_COUNT)?;
        let flags = cursor.u32()?;
        if flags & !1 != 0 {
            return Err(LayerCodecError::UnknownRecordFlags {
                record: "contour",
                index: contour_index,
                flags,
            });
        }
        for _ in 0..count {
            let point_index = state.point_index;
            let point_id = state.required_string(cursor.u32()?)?;
            state.unique_identity("point", point_index, point_id)?;
            let point_type = cursor.u8()?;
            LayerPointType::from_byte(point_type, point_index)?;
            let flags = cursor.u8()?;
            if flags & !1 != 0 {
                return Err(LayerCodecError::UnknownRecordFlags {
                    record: "point",
                    index: point_index,
                    flags: u32::from(flags),
                });
            }
            if cursor.u16()? != 0 {
                return Err(LayerCodecError::NonZeroReserved {
                    record: "point",
                    index: point_index,
                });
            }
            validate_finite(cursor.f64()?, "point coordinate", point_index * 2)?;
            validate_finite(cursor.f64()?, "point coordinate", point_index * 2 + 1)?;
            state.point_index += 1;
        }
    }
    if actual_points != point_count {
        return Err(LayerCodecError::PointCountMismatch {
            expected: point_count,
            actual: actual_points,
        });
    }

    let components_offset = cursor.offset;
    for index in 0..component_count {
        let id = state.required_string(cursor.u32()?)?;
        state.unique_identity("component", index, id)?;
        state.required_string(cursor.u32()?)?;
        state.required_string(cursor.u32()?)?;
        if cursor.u32()? != 0 {
            return Err(LayerCodecError::NonZeroReserved {
                record: "component",
                index,
            });
        }
        for value_index in 0..9 {
            validate_finite(
                cursor.f64()?,
                "component transform",
                index * 9 + value_index,
            )?;
        }
    }
    let anchors_offset = cursor.offset;
    for index in 0..anchor_count {
        let id = state.required_string(cursor.u32()?)?;
        state.unique_identity("anchor", index, id)?;
        state.optional_string(cursor.u32()?)?;
        validate_finite(cursor.f64()?, "anchor coordinate", index * 2)?;
        validate_finite(cursor.f64()?, "anchor coordinate", index * 2 + 1)?;
    }
    let guidelines_offset = cursor.offset;
    for index in 0..guideline_count {
        let id = state.required_string(cursor.u32()?)?;
        state.unique_identity("guideline", index, id)?;
        state.optional_string(cursor.u32()?)?;
        state.optional_string(cursor.u32()?)?;
        let flags = cursor.u32()?;
        if flags & !7 != 0 {
            return Err(LayerCodecError::UnknownRecordFlags {
                record: "guideline",
                index,
                flags,
            });
        }
        for (value_index, bit) in [1, 2, 4].into_iter().enumerate() {
            let value = cursor.f64()?;
            if flags & bit != 0 {
                validate_finite(value, "guideline number", index * 3 + value_index)?;
            } else {
                validate_absent(value, "guideline number", index * 3 + value_index)?;
            }
        }
    }
    let lib_offset = cursor.offset;
    let lib_end = lib_offset
        .checked_add(lib_bytes)
        .ok_or(LayerCodecError::LengthOverflow)?;
    if lib_end > bytes.len() {
        return Err(LayerCodecError::Truncated {
            offset: lib_offset,
            needed: lib_bytes,
            available: bytes.len().saturating_sub(lib_offset),
        });
    }
    cursor.end = lib_end;
    decode_map(&mut cursor, &mut state, 0)?;
    let consumed_lib = cursor.offset - lib_offset;
    if consumed_lib != lib_bytes {
        return Err(LayerCodecError::LibLengthMismatch {
            expected: lib_bytes,
            actual: consumed_lib,
        });
    }
    if lib_end != bytes.len() {
        return Err(LayerCodecError::LengthMismatch {
            expected: lib_end,
            actual: bytes.len(),
        });
    }
    if state.next_string != string_count as u32 {
        return Err(LayerCodecError::UnreferencedStrings {
            first: state.next_string,
        });
    }

    Ok(GlyphLayerView {
        bytes,
        strings,
        id_index,
        source_id_index,
        width,
        height,
        contour_count,
        point_count,
        component_count,
        anchor_count,
        guideline_count,
        contours_offset,
        components_offset,
        anchors_offset,
        guidelines_offset,
        lib_offset,
        lib_end,
    })
}

#[derive(Default)]
struct StringPool {
    values: Vec<String>,
    indexes: HashMap<String, u32>,
}
impl StringPool {
    fn intern(&mut self, value: &str) -> Result<u32, LayerCodecError> {
        if let Some(index) = self.indexes.get(value) {
            return Ok(*index);
        }
        check_limit(
            "string count",
            self.values.len() + 1,
            MAX_LAYER_STRING_COUNT,
        )?;
        let index =
            u32::try_from(self.values.len()).map_err(|_| LayerCodecError::LengthOverflow)?;
        self.values.push(value.to_owned());
        self.indexes.insert(value.to_owned(), index);
        Ok(index)
    }
    fn index(&self, value: &str) -> u32 {
        *self
            .indexes
            .get(value)
            .expect("strings gathered before encoding")
    }
}

struct DecodeState<'a> {
    strings: Strings<'a>,
    next_string: u32,
    identities: HashMap<&'static str, HashSet<&'a str>>,
    point_index: usize,
    lib_values: usize,
    validate_references: bool,
}
impl<'a> DecodeState<'a> {
    fn new(strings: Strings<'a>) -> Self {
        Self {
            strings,
            next_string: 0,
            identities: HashMap::new(),
            point_index: 0,
            lib_values: 0,
            validate_references: true,
        }
    }
    fn for_validated(strings: Strings<'a>) -> Self {
        Self {
            validate_references: false,
            ..Self::new(strings)
        }
    }
    fn reference(&mut self, index: u32) -> Result<(), LayerCodecError> {
        if index as usize >= self.strings.count {
            return Err(LayerCodecError::StringReferenceOutOfRange { index });
        }
        if self.validate_references {
            if index > self.next_string {
                return Err(LayerCodecError::NonCanonicalStringReference {
                    expected_at_most: self.next_string,
                    actual: index,
                });
            }
            if index == self.next_string {
                self.next_string += 1;
            }
        }
        Ok(())
    }
    fn required_string(&mut self, index: u32) -> Result<&'a str, LayerCodecError> {
        self.reference(index)?;
        Ok(self.strings.get(index))
    }
    fn optional_string(&mut self, index: u32) -> Result<Option<&'a str>, LayerCodecError> {
        if index == NONE_STRING {
            Ok(None)
        } else {
            self.required_string(index).map(Some)
        }
    }
    fn unique_identity(
        &mut self,
        kind: &'static str,
        index: usize,
        value: &'a str,
    ) -> Result<(), LayerCodecError> {
        if !self.identities.entry(kind).or_default().insert(value) {
            return Err(LayerCodecError::DuplicateIdentity { kind, index });
        }
        Ok(())
    }
    fn count_lib_value(&mut self) -> Result<(), LayerCodecError> {
        self.lib_values = self
            .lib_values
            .checked_add(1)
            .ok_or(LayerCodecError::LengthOverflow)?;
        check_limit("lib value count", self.lib_values, MAX_LAYER_LIB_VALUES)
    }
}

#[derive(Clone, Copy)]
struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
    end: usize,
}
impl<'a> Cursor<'a> {
    fn with_range(bytes: &'a [u8], offset: usize, end: usize) -> Self {
        Self { bytes, offset, end }
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8], LayerCodecError> {
        let next = self
            .offset
            .checked_add(count)
            .ok_or(LayerCodecError::LengthOverflow)?;
        if next > self.end {
            return Err(LayerCodecError::Truncated {
                offset: self.offset,
                needed: count,
                available: self.end.saturating_sub(self.offset),
            });
        }
        let value = &self.bytes[self.offset..next];
        self.offset = next;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, LayerCodecError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, LayerCodecError> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("fixed width"),
        ))
    }
    fn u32(&mut self) -> Result<u32, LayerCodecError> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("fixed width"),
        ))
    }
    fn i64(&mut self) -> Result<i64, LayerCodecError> {
        Ok(i64::from_le_bytes(
            self.take(8)?.try_into().expect("fixed width"),
        ))
    }
    fn u64(&mut self) -> Result<u64, LayerCodecError> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().expect("fixed width"),
        ))
    }
    fn f64(&mut self) -> Result<f64, LayerCodecError> {
        Ok(f64::from_le_bytes(
            self.take(8)?.try_into().expect("fixed width"),
        ))
    }
}

fn decode_map(
    cursor: &mut Cursor<'_>,
    state: &mut DecodeState<'_>,
    depth: usize,
) -> Result<BTreeMap<String, LayerLibValue>, LayerCodecError> {
    check_depth(depth)?;
    let count = cursor.u32()? as usize;
    check_limit(
        "lib value count",
        state.lib_values.saturating_add(count),
        MAX_LAYER_LIB_VALUES,
    )?;
    let mut values = BTreeMap::new();
    let mut previous: Option<&str> = None;
    for _ in 0..count {
        let key_offset = cursor.offset;
        let key = state.required_string(cursor.u32()?)?;
        if previous.is_some_and(|value| value.as_bytes() >= key.as_bytes()) {
            return Err(LayerCodecError::NonCanonicalMapOrder { offset: key_offset });
        }
        previous = Some(key);
        let value = decode_lib_value(cursor, state, depth + 1)?;
        values.insert(key.to_owned(), value);
    }
    Ok(values)
}

fn decode_lib_value(
    cursor: &mut Cursor<'_>,
    state: &mut DecodeState<'_>,
    depth: usize,
) -> Result<LayerLibValue, LayerCodecError> {
    check_depth(depth)?;
    state.count_lib_value()?;
    let tag_offset = cursor.offset;
    let tag = cursor.u8()?;
    if cursor.u8()? != 0 || cursor.u16()? != 0 {
        return Err(LayerCodecError::NonZeroReserved {
            record: "lib value",
            index: state.lib_values - 1,
        });
    }
    match tag {
        0 => Ok(LayerLibValue::String(
            state.required_string(cursor.u32()?)?.to_owned(),
        )),
        1 => Ok(LayerLibValue::Integer(cursor.i64()?)),
        2 => Ok(LayerLibValue::UnsignedInteger(cursor.u64()?)),
        3 => {
            let value = cursor.f64()?;
            validate_finite(value, "lib float", state.lib_values - 1)?;
            Ok(LayerLibValue::Float(value))
        }
        4 => {
            let offset = cursor.offset;
            let value = cursor.u8()?;
            if cursor.take(3)? != [0, 0, 0] {
                return Err(LayerCodecError::NonZeroReserved {
                    record: "lib boolean",
                    index: state.lib_values - 1,
                });
            }
            match value {
                0 => Ok(LayerLibValue::Boolean(false)),
                1 => Ok(LayerLibValue::Boolean(true)),
                value => Err(LayerCodecError::InvalidBoolean { offset, value }),
            }
        }
        5 => {
            let count = cursor.u32()? as usize;
            check_limit(
                "lib value count",
                state.lib_values.saturating_add(count),
                MAX_LAYER_LIB_VALUES,
            )?;
            let mut values = Vec::with_capacity(count);
            for _ in 0..count {
                values.push(decode_lib_value(cursor, state, depth + 1)?);
            }
            Ok(LayerLibValue::Array(values))
        }
        6 => Ok(LayerLibValue::Dict(decode_map(cursor, state, depth + 1)?)),
        7 => {
            let count = cursor.u32()? as usize;
            Ok(LayerLibValue::Data(cursor.take(count)?.to_vec()))
        }
        8 => Ok(LayerLibValue::Date(
            state.required_string(cursor.u32()?)?.to_owned(),
        )),
        9 => Ok(LayerLibValue::Uid(cursor.u64()?)),
        value => Err(LayerCodecError::UnknownLibTag {
            offset: tag_offset,
            value,
        }),
    }
}

fn gather_map_strings(
    values: &BTreeMap<String, LayerLibValue>,
    strings: &mut StringPool,
    depth: usize,
    count: &mut usize,
) -> Result<(), LayerCodecError> {
    check_depth(depth)?;
    for (key, value) in sorted_map(values) {
        strings.intern(key)?;
        gather_value_strings(value, strings, depth + 1, count)?;
    }
    Ok(())
}
fn gather_value_strings(
    value: &LayerLibValue,
    strings: &mut StringPool,
    depth: usize,
    count: &mut usize,
) -> Result<(), LayerCodecError> {
    check_depth(depth)?;
    *count = count
        .checked_add(1)
        .ok_or(LayerCodecError::LengthOverflow)?;
    check_limit("lib value count", *count, MAX_LAYER_LIB_VALUES)?;
    match value {
        LayerLibValue::String(value) | LayerLibValue::Date(value) => {
            strings.intern(value)?;
        }
        LayerLibValue::Array(values) => {
            for value in values {
                gather_value_strings(value, strings, depth + 1, count)?;
            }
        }
        LayerLibValue::Dict(values) => gather_map_strings(values, strings, depth + 1, count)?,
        LayerLibValue::Integer(_)
        | LayerLibValue::UnsignedInteger(_)
        | LayerLibValue::Float(_)
        | LayerLibValue::Boolean(_)
        | LayerLibValue::Data(_)
        | LayerLibValue::Uid(_) => {}
    }
    Ok(())
}

fn encode_map(
    bytes: &mut Vec<u8>,
    values: &BTreeMap<String, LayerLibValue>,
    strings: &StringPool,
    depth: usize,
    count: &mut usize,
) -> Result<(), LayerCodecError> {
    check_depth(depth)?;
    push_u32(bytes, values.len())?;
    for (key, value) in sorted_map(values) {
        push_u32(bytes, strings.index(key))?;
        encode_lib_value(bytes, value, strings, depth + 1, count)?;
    }
    Ok(())
}
fn encode_lib_value(
    bytes: &mut Vec<u8>,
    value: &LayerLibValue,
    strings: &StringPool,
    depth: usize,
    count: &mut usize,
) -> Result<(), LayerCodecError> {
    check_depth(depth)?;
    *count = count
        .checked_add(1)
        .ok_or(LayerCodecError::LengthOverflow)?;
    check_limit("lib value count", *count, MAX_LAYER_LIB_VALUES)?;
    let tag = match value {
        LayerLibValue::String(_) => 0,
        LayerLibValue::Integer(_) => 1,
        LayerLibValue::UnsignedInteger(_) => 2,
        LayerLibValue::Float(_) => 3,
        LayerLibValue::Boolean(_) => 4,
        LayerLibValue::Array(_) => 5,
        LayerLibValue::Dict(_) => 6,
        LayerLibValue::Data(_) => 7,
        LayerLibValue::Date(_) => 8,
        LayerLibValue::Uid(_) => 9,
    };
    bytes.extend_from_slice(&[tag, 0, 0, 0]);
    match value {
        LayerLibValue::String(value) | LayerLibValue::Date(value) => {
            push_u32(bytes, strings.index(value))?
        }
        LayerLibValue::Integer(value) => bytes.extend_from_slice(&value.to_le_bytes()),
        LayerLibValue::UnsignedInteger(value) | LayerLibValue::Uid(value) => {
            bytes.extend_from_slice(&value.to_le_bytes())
        }
        LayerLibValue::Float(value) => bytes.extend_from_slice(&value.to_le_bytes()),
        LayerLibValue::Boolean(value) => bytes.extend_from_slice(&[u8::from(*value), 0, 0, 0]),
        LayerLibValue::Array(values) => {
            push_u32(bytes, values.len())?;
            for value in values {
                encode_lib_value(bytes, value, strings, depth + 1, count)?;
            }
        }
        LayerLibValue::Dict(values) => encode_map(bytes, values, strings, depth + 1, count)?,
        LayerLibValue::Data(value) => {
            push_u32(bytes, value.len())?;
            bytes.extend_from_slice(value);
        }
    }
    Ok(())
}

fn sorted_map(values: &BTreeMap<String, LayerLibValue>) -> Vec<(&String, &LayerLibValue)> {
    let mut values = values.iter().collect::<Vec<_>>();
    values.sort_unstable_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    values
}

fn validate_strings(strings: Strings<'_>, expected_bytes: usize) -> Result<(), LayerCodecError> {
    if read_u32(strings.bytes, strings.offsets_offset) != 0 {
        return Err(LayerCodecError::InvalidStringOffsets { index: 0 });
    }
    let mut previous = 0usize;
    let mut seen = HashSet::with_capacity(strings.count);
    for index in 0..strings.count {
        let end = read_u32(strings.bytes, strings.offsets_offset + (index + 1) * 4) as usize;
        if end < previous || end > expected_bytes {
            return Err(LayerCodecError::InvalidStringOffsets { index: index + 1 });
        }
        let value = std::str::from_utf8(
            &strings.bytes[strings.values_offset + previous..strings.values_offset + end],
        )
        .map_err(|_| LayerCodecError::InvalidUtf8 { index })?;
        if !seen.insert(value) {
            return Err(LayerCodecError::DuplicateString { index });
        }
        previous = end;
    }
    if previous != expected_bytes {
        return Err(LayerCodecError::InvalidStringOffsets {
            index: strings.count,
        });
    }
    Ok(())
}

fn validate_finite(value: f64, field: &'static str, index: usize) -> Result<(), LayerCodecError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(LayerCodecError::NonFiniteNumber { field, index })
    }
}
fn validate_absent(value: f64, field: &'static str, index: usize) -> Result<(), LayerCodecError> {
    if value.to_bits() == 0 {
        Ok(())
    } else {
        Err(LayerCodecError::NonCanonicalAbsentNumber { field, index })
    }
}
fn check_depth(depth: usize) -> Result<(), LayerCodecError> {
    if depth > MAX_LAYER_LIB_DEPTH {
        Err(LayerCodecError::NestingLimitExceeded {
            limit: MAX_LAYER_LIB_DEPTH,
        })
    } else {
        Ok(())
    }
}
fn check_limit(field: &'static str, actual: usize, limit: usize) -> Result<(), LayerCodecError> {
    if actual > limit {
        Err(LayerCodecError::LimitExceeded {
            field,
            limit,
            actual,
        })
    } else {
        Ok(())
    }
}
fn require_range(bytes: &[u8], offset: usize, count: usize) -> Result<(), LayerCodecError> {
    let end = offset
        .checked_add(count)
        .ok_or(LayerCodecError::LengthOverflow)?;
    if end > bytes.len() {
        Err(LayerCodecError::Truncated {
            offset,
            needed: count,
            available: bytes.len().saturating_sub(offset),
        })
    } else {
        Ok(())
    }
}
fn push_u32<T>(bytes: &mut Vec<u8>, value: T) -> Result<(), LayerCodecError>
where
    T: TryInto<u32>,
{
    let value = value
        .try_into()
        .ok()
        .ok_or(LayerCodecError::LengthOverflow)?;
    bytes.extend_from_slice(&value.to_le_bytes());
    Ok(())
}
fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}
fn write_u32<T>(bytes: &mut [u8], offset: usize, value: T) -> Result<(), LayerCodecError>
where
    T: TryInto<u32>,
{
    let value = value
        .try_into()
        .ok()
        .ok_or(LayerCodecError::LengthOverflow)?;
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    Ok(())
}
fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().expect("fixed width"))
}
fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("fixed width"))
}
fn read_f64(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(bytes[offset..offset + 8].try_into().expect("fixed width"))
}
