# Shift glyph-codec specification

Status: normative for `shift.glyph-outline.v1` and `shift.glyph-layer.v1`

## Compatibility and ownership

The glyph-codec family uses one common frame and independently versioned payload
kinds. The byte specification and shared golden vectors define compatibility;
implementations do not define the format by accident.

- `shift.glyph-outline.v1` (`payloadKind = 0x01`, `formatVersion = 0x01`) is a
  derived, flattened preview/rendering outline. Components are already resolved,
  coordinates are drawing coordinates, and f64-to-f32 loss is permitted. It is
  never authoritative editable glyph state.
- `shift.glyph-layer.v1` (`payloadKind = 0x02`, `formatVersion = 0x01`) is one
  canonical authored glyph layer. It preserves stable identities, authored point
  semantics and ordering, contour closure, smooth flags, components and
  transforms, anchors, guidelines, lib metadata, and authored f64 precision.

`PackedGlyphLayer` and `PackedGlyphOutline` are distinct opaque values. Outline
bytes must never be persisted or written back as a glyph layer.

An incompatible interpretation uses a new version scoped to its payload kind.
Unknown kinds, versions, flag bits, point types, and lib tags are errors. Codec
implementations own framing, validation, errors, borrowed iteration, and opaque
packed values; they do not own font semantics, transport, persistence, DOM,
canvas, SQLite, or derived Slug/GPU layouts.

## Common frame

All multibyte integers and IEEE-754 values are little-endian.

```text
u8[4] magic          ASCII "SHFT"
u8    payloadKind    0x01 = glyph-outline; 0x02 = glyph-layer
u8    formatVersion  version scoped to payloadKind
u16   flags          zero in both v1 formats
```

## `shift.glyph-outline.v1`

One buffer represents one resolved outline.

```text
u8[4] magic                  "SHFT"
u8    payloadKind            0x01
u8    formatVersion          0x01
u16   flags                  0
u32   commandCount
u32   coordCount             number of f32 values, not points
u8[commandCount] commands
u8[...] zero padding         coordinate section begins at a 4-byte offset
f32[coordCount] coordinates
```

Its exact byte length is:

```text
16 + align4(commandCount) + 4 * coordCount
```

No trailing bytes are permitted.

### Commands

| Byte | Command | Coordinates consumed |
| ---: | --- | ---: |
| `0` | `Move(x, y)` | 2 |
| `1` | `Line(x, y)` | 2 |
| `2` | `Quad(cx, cy, x, y)` | 4 |
| `3` | `Cubic(c1x, c1y, c2x, c2y, x, y)` | 6 |
| `4` | `Close` | 0 |

The general segment set is intentional. Any quadratic-only Slug reduction is a
consumer transformation after decode.

### Command state

- An empty outline is valid only when both counts are zero.
- Every non-empty contour begins with `Move`.
- `Line`, `Quad`, and `Cubic` require an active contour.
- `Close` requires an active contour with at least one drawing segment and ends
  that contour.
- After `Close`, only `Move` or the end of the stream is legal.
- A new `Move` may end an open contour and begin another.
- Open contours are legal.
- The command arity sum equals `coordCount` exactly.

### Coordinates

Coordinates are finite IEEE-754 binary32 values. An encoder receiving f64
coordinates rejects non-finite inputs and finite inputs whose conversion is not
a finite f32. NaN and either infinity are invalid on decode.

### Strict validation

A decoder returns either one complete validated view or an error. It rejects:

- truncated framing or body sections;
- wrong magic, kind, version, or non-zero flags;
- unknown commands and illegal state transitions;
- an arity sum different from `coordCount`;
- non-zero alignment padding;
- non-finite coordinates;
- arithmetic overflow and configured implementation-limit violations;
- lengths inconsistent with counts and all trailing bytes.

V1 implementations in this repository apply the same explicit limits before
allocation or command iteration:

- at most 1,000,000 commands;
- at most 6,000,000 coordinates;
- at most 32 MiB total payload bytes.

## `shift.glyph-layer.v1`

One buffer represents one independently replaceable authored glyph layer. The
layer and source identities are included so a payload cannot be detached from
its semantic ownership accidentally.

### Fixed header

The fixed header is 72 bytes:

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `u8[4]` | magic `SHFT` |
| 4 | `u8` | payload kind `0x02` |
| 5 | `u8` | format version `0x01` |
| 6 | `u16` | frame flags, zero |
| 8 | `u32` | exact total payload byte length |
| 12 | `u32` | distinct string count |
| 16 | `u32` | combined UTF-8 string byte length |
| 20 | `u32` | contour count |
| 24 | `u32` | total point count across contours |
| 28 | `u32` | component count |
| 32 | `u32` | anchor count |
| 36 | `u32` | guideline count |
| 40 | `u32` | encoded layer-lib byte length |
| 44 | `u32` | layer-ID string index |
| 48 | `u32` | source-ID string index |
| 52 | `u32` | layer flags; bit 0 means height is present |
| 56 | `f64` | width |
| 64 | `f64` | height, or positive-zero bits when absent |

All count and byte-length fields describe the uncompressed v1 payload. V1 has no
compression flag. Compression belongs in an explicitly versioned outer storage
record or a future format revision.

### Canonical string table

The fixed header is followed by:

```text
u32[stringCount + 1] offsets
u8[stringBytes] values
```

Offsets are relative to `values`, begin at zero, never decrease, and end at
`stringBytes`. Each slice is strict UTF-8. Values are unique, including empty
strings.

Every string-bearing record stores a `u32` table index. Optional strings use
`0xffffffff` for absence. The table is in first-reference order over the wire:
layer ID, source ID, then each section and nested lib value in the order below.
A decoder rejects skipped first references and unreferenced table entries. This
makes equivalent inputs encode byte-for-byte identically without imposing a
lexical sort on identities or authored entity order.

### Contours and points

Contours preserve authored order. Each contour is:

```text
u32 idString
u32 pointCount
u32 flags          bit 0 = closed; all other bits zero
Point[pointCount]
```

Each 24-byte point is:

```text
u32 idString
u8  pointType      0 = on-curve; 1 = off-curve; 2 = qcurve
u8  flags          bit 0 = smooth; all other bits zero
u16 reserved       zero
f64 x
f64 y
```

Empty open or closed contours are representable because authored structure is
preserved rather than inferred from drawing commands. Point IDs must be unique
within the payload; contour IDs must likewise be unique.

### Components

Components preserve authored order. Each 88-byte component is:

```text
u32 idString
u32 baseGlyphIdString
u32 baseGlyphNameString
u32 reserved       zero
f64 translateX
f64 translateY
f64 rotation
f64 scaleX
f64 scaleY
f64 skewX
f64 skewY
f64 transformCenterX
f64 transformCenterY
```

The decomposed authored transform is preserved directly. Components are not
flattened, and base glyph identity is not inferred from the editable name.
Component IDs must be unique within the payload.

### Anchors

Anchors preserve authored order. Each 24-byte anchor is:

```text
u32 idString
u32 nameString     or 0xffffffff
f64 x
f64 y
```

Anchor IDs must be unique within the payload.

### Guidelines

Guidelines preserve authored order. Each 40-byte guideline is:

```text
u32 idString
u32 nameString     or 0xffffffff
u32 colorString    or 0xffffffff
u32 flags          bit 0 = x present; bit 1 = y present; bit 2 = angle present
f64 x              positive-zero bits when absent
f64 y              positive-zero bits when absent
f64 angle          positive-zero bits when absent
```

Guideline IDs must be unique within the payload.

### Layer lib

The final section has exactly the header's `layerLibBytes`. Its root is a
canonical dictionary:

```text
u32 entryCount
Entry[entryCount]

Entry := u32 keyString, Value value
Value := u8 tag, u8 reservedZero, u16 reservedZero, tag-specific payload
```

Dictionary keys are strictly increasing by their UTF-8 bytes. Duplicate keys
are therefore invalid. Arrays preserve authored order.

| Tag | Value | Payload |
| ---: | --- | --- |
| 0 | string | `u32 stringIndex` |
| 1 | signed integer | `i64` |
| 2 | unsigned integer | `u64` |
| 3 | float | finite `f64` |
| 4 | boolean | `u8` 0 or 1, then three zero bytes |
| 5 | array | `u32 count`, then `Value[count]` |
| 6 | dictionary | root dictionary layout |
| 7 | binary data | `u32 byteLength`, then exact bytes |
| 8 | date | `u32 stringIndex` containing the preserved date text |
| 9 | archive UID | `u64` |

### Numbers, identity, and order

All authored numeric fields are finite IEEE-754 binary64 values and preserve
their exact bits, including negative zero when present. Optional absent numeric
slots use positive-zero bits so there is only one canonical encoding.

Contour, point, component, anchor, and guideline identity is unique within its
entity kind in one payload. Font-wide identity and typed ID prefixes are domain
validation at the `shift-font` adapter boundary. The codec does not mint IDs or
infer missing structure.

Authored order is preserved for contours, points, components, anchors,
guidelines, arrays, and all other sequence-valued fields. Dictionaries are maps,
not authored sequences, and use canonical UTF-8 key order.

### Strict validation and limits

A layer decoder validates the complete payload before exposing any view. It
rejects malformed framing, lengths, counts, offsets, UTF-8, references,
first-use order, duplicate strings or identities, unknown flags/types/tags,
non-zero reserved bytes, non-finite values, non-canonical absent slots,
non-canonical dictionary order, excessive nesting, truncation, and trailing
bytes.

Repository v1 implementations apply these limits before unbounded allocation or
iteration:

- 1,000,000 contours;
- 4,000,000 points;
- 1,000,000 components, anchors, and guidelines each;
- 4,000,000 distinct strings and 64 MiB combined UTF-8;
- 1,000,000 nested lib values and recursion depth 64; each value and each dictionary container consumes one recursion level, while an array consumes its value level plus one level per nested value;
- 256 MiB total payload bytes.

The Rust borrowed view and TypeScript iterable view expose one layer's structure
incrementally. Consumers can build derived projections one contour/entity at a
time without constructing a complete font or retaining every editable layer.

## Implementation structure

Both implementations share one frame parser/writer across payload kinds. Rust
keeps outline and layer codecs in separate modules and caches validated layer
offsets in `PackedGlyphLayer`. TypeScript separates frame, binary cursor/writer,
string-table, lib-value, and limit handling from the layer views. Successful
encoding validates writer input and constructs its offsets while writing; only
externally supplied bytes run the complete decoder in release builds.

## Golden vectors

Canonical binary vectors are checked in at:

- `fixtures/glyph-codec/outline-v1/`
- `fixtures/glyph-codec/layer-v1/`

Each fixture directory includes a `vectors.json` manifest. Dedicated Rust and
TypeScript fixture tests parse those manifests, verify every declared byte
length and SHA-256 digest, decode the bytes, and require canonical re-encoding
to reproduce every byte. Format behavior tests remain separate. Any accepted
canonical payload must round-trip byte-for-byte.
