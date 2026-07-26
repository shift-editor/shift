# Shift glyph-codec specification

Status: normative for `shift.glyph-outline.v1`

## Compatibility and ownership

The glyph-codec family uses one common frame and independently versioned payload
kinds. The byte specification and shared golden vectors define compatibility;
implementations do not define the format by accident.

- `shift.glyph-outline.v1` (`payloadKind = 0x01`, `formatVersion = 0x01`) is a
  derived, flattened preview/rendering outline. Components are already resolved,
  coordinates are drawing coordinates, and f64-to-f32 loss is permitted. It is
  never authoritative editable glyph state.
- `payloadKind = 0x02` is reserved for a future `shift.glyph-layer.v1` format.
  That separate canonical format must preserve stable identities, authored point
  semantics and ordering, contour closure, smooth flags, components and
  transforms, anchors, metadata, and authored f64 precision. Outline bytes must
  never be persisted or written back as a glyph layer.

A future incompatible interpretation uses a new version scoped to its payload
kind. Unknown kinds, versions, and flag bits are errors. Codec implementations
own framing, validation, errors, and opaque packed values; they do not own font
semantics, transport, persistence, DOM, canvas, or SQLite behavior.

## Common frame

All multibyte values are little-endian.

```text
u8[4] magic          ASCII "SHFT"
u8    payloadKind    0x01 = glyph-outline; 0x02 reserved for glyph-layer
u8    formatVersion  version scoped to payloadKind
u16   flags          zero in outline v1
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

These are implementation safety limits, not permission for future v1 encoders
to alter framing.

## Golden vectors

Canonical binary vectors are checked in at
`fixtures/glyph-codec/outline-v1/`. Rust and TypeScript tests both consume those
same files and compare decoded commands and f32 coordinates. Re-encoding any
accepted canonical vector must reproduce every byte, including zero padding.
