use shift_glyph_codec::{
    decode_outline, pack_outline, CodecError, CommandOrderError, OutlineCommand, MAX_COMMAND_COUNT,
};

type Command64 = OutlineCommand<f64>;
type Command32 = OutlineCommand<f32>;

const EMPTY: &[u8] = include_bytes!("../../../fixtures/glyph-codec/outline-v1/empty.bin");
const CLOSED_LINE: &[u8] =
    include_bytes!("../../../fixtures/glyph-codec/outline-v1/closed-line.bin");
const OPEN: &[u8] = include_bytes!("../../../fixtures/glyph-codec/outline-v1/open.bin");
const CURVES: &[u8] =
    include_bytes!("../../../fixtures/glyph-codec/outline-v1/quadratic-cubic.bin");
const MULTIPLE: &[u8] =
    include_bytes!("../../../fixtures/glyph-codec/outline-v1/multiple-contours.bin");

fn golden_vectors() -> Vec<(&'static str, &'static [u8], Vec<Command64>)> {
    vec![
        ("empty", EMPTY, vec![]),
        (
            "closed-line",
            CLOSED_LINE,
            vec![
                Command64::Move { x: 0.0, y: 0.0 },
                Command64::Line { x: 100.0, y: 200.0 },
                Command64::Close,
            ],
        ),
        (
            "open",
            OPEN,
            vec![
                Command64::Move { x: -12.5, y: 0.25 },
                Command64::Line {
                    x: 123.75,
                    y: -456.5,
                },
            ],
        ),
        (
            "quadratic-cubic",
            CURVES,
            vec![
                Command64::Move { x: -1.5, y: 2.25 },
                Command64::Quad {
                    cx: 0.5,
                    cy: -0.75,
                    x: 1000.125,
                    y: -2000.5,
                },
                Command64::Cubic {
                    c1x: -3.0,
                    c1y: 4.5,
                    c2x: 5.25,
                    c2y: -6.75,
                    x: 1.0e20,
                    y: -1.0e20,
                },
                Command64::Close,
            ],
        ),
        (
            "multiple-contours",
            MULTIPLE,
            vec![
                Command64::Move { x: 0.0, y: 0.0 },
                Command64::Line { x: 10.0, y: 0.0 },
                Command64::Close,
                Command64::Move {
                    x: 100.5,
                    y: -100.25,
                },
                Command64::Line { x: 200.0, y: 300.0 },
            ],
        ),
    ]
}

fn as_f32(command: Command64) -> Command32 {
    match command {
        Command64::Move { x, y } => Command32::Move {
            x: x as f32,
            y: y as f32,
        },
        Command64::Line { x, y } => Command32::Line {
            x: x as f32,
            y: y as f32,
        },
        Command64::Quad { cx, cy, x, y } => Command32::Quad {
            cx: cx as f32,
            cy: cy as f32,
            x: x as f32,
            y: y as f32,
        },
        Command64::Cubic {
            c1x,
            c1y,
            c2x,
            c2y,
            x,
            y,
        } => Command32::Cubic {
            c1x: c1x as f32,
            c1y: c1y as f32,
            c2x: c2x as f32,
            c2y: c2y as f32,
            x: x as f32,
            y: y as f32,
        },
        Command64::Close => Command32::Close,
    }
}

fn as_f64(command: Command32) -> Command64 {
    match command {
        Command32::Move { x, y } => Command64::Move {
            x: f64::from(x),
            y: f64::from(y),
        },
        Command32::Line { x, y } => Command64::Line {
            x: f64::from(x),
            y: f64::from(y),
        },
        Command32::Quad { cx, cy, x, y } => Command64::Quad {
            cx: f64::from(cx),
            cy: f64::from(cy),
            x: f64::from(x),
            y: f64::from(y),
        },
        Command32::Cubic {
            c1x,
            c1y,
            c2x,
            c2y,
            x,
            y,
        } => Command64::Cubic {
            c1x: f64::from(c1x),
            c1y: f64::from(c1y),
            c2x: f64::from(c2x),
            c2y: f64::from(c2y),
            x: f64::from(x),
            y: f64::from(y),
        },
        Command32::Close => Command64::Close,
    }
}

fn raw_outline(commands: &[u8], coordinates: &[f32]) -> Vec<u8> {
    let aligned_commands = (commands.len() + 3) & !3;
    let mut bytes = Vec::with_capacity(16 + aligned_commands + coordinates.len() * 4);
    bytes.extend_from_slice(b"SHFT");
    bytes.extend_from_slice(&[1, 1, 0, 0]);
    bytes.extend_from_slice(&(commands.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(coordinates.len() as u32).to_le_bytes());
    bytes.extend_from_slice(commands);
    bytes.resize(16 + aligned_commands, 0);
    for coordinate in coordinates {
        bytes.extend_from_slice(&coordinate.to_le_bytes());
    }
    bytes
}

fn canonicalize(bytes: &[u8]) -> Option<Vec<u8>> {
    let view = decode_outline(bytes).ok()?;
    let commands = view.commands().map(as_f64).collect::<Vec<_>>();
    Some(pack_outline(&commands).unwrap().into_bytes())
}

#[test]
fn shared_golden_vectors_decode_and_reencode_byte_for_byte() {
    for (name, bytes, expected) in golden_vectors() {
        let view = decode_outline(bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
        let expected_f32 = expected.iter().copied().map(as_f32).collect::<Vec<_>>();

        assert_eq!(view.commands().collect::<Vec<_>>(), expected_f32, "{name}");
        assert_eq!(pack_outline(&expected).unwrap().as_bytes(), bytes, "{name}");
        assert_eq!(canonicalize(bytes).as_deref(), Some(bytes), "{name}");
    }
}

#[test]
fn golden_vectors_cover_every_command_alignment_padding_length() {
    let remainders = golden_vectors()
        .into_iter()
        .map(|(_, bytes, _)| decode_outline(bytes).unwrap().command_count() % 4)
        .collect::<std::collections::HashSet<_>>();

    assert_eq!(remainders, [0, 1, 2, 3].into_iter().collect());
}

#[test]
fn decoder_rejects_truncation_and_trailing_bytes() {
    for length in 0..CURVES.len() {
        assert!(
            decode_outline(&CURVES[..length]).is_err(),
            "length {length}"
        );
    }

    let mut trailing = CURVES.to_vec();
    trailing.push(0);
    assert!(matches!(
        decode_outline(&trailing),
        Err(CodecError::LengthMismatch { .. })
    ));
}

#[test]
fn decoder_rejects_wrong_framing_and_unknown_flags() {
    let mut bytes = OPEN.to_vec();
    bytes[0] = b'X';
    assert_eq!(decode_outline(&bytes), Err(CodecError::WrongMagic));

    let mut bytes = OPEN.to_vec();
    bytes[4] = 2;
    assert_eq!(
        decode_outline(&bytes),
        Err(CodecError::UnsupportedPayloadKind(2))
    );

    let mut bytes = OPEN.to_vec();
    bytes[5] = 2;
    assert_eq!(
        decode_outline(&bytes),
        Err(CodecError::UnsupportedVersion(2))
    );

    let mut bytes = OPEN.to_vec();
    bytes[6] = 1;
    assert_eq!(decode_outline(&bytes), Err(CodecError::UnknownFlags(1)));
}

#[test]
fn decoder_rejects_unknown_commands_and_every_illegal_ordering_boundary() {
    let unknown = raw_outline(&[9], &[]);
    assert!(matches!(
        decode_outline(&unknown),
        Err(CodecError::UnknownCommand { .. })
    ));

    let drawing_first = raw_outline(&[1], &[1.0, 2.0]);
    assert_eq!(
        decode_outline(&drawing_first),
        Err(CodecError::InvalidCommandOrder {
            index: 0,
            reason: CommandOrderError::DrawingCommandWithoutContour,
        })
    );

    let close_first = raw_outline(&[4], &[]);
    assert_eq!(
        decode_outline(&close_first),
        Err(CodecError::InvalidCommandOrder {
            index: 0,
            reason: CommandOrderError::CloseWithoutContour,
        })
    );

    let empty_close = raw_outline(&[0, 4], &[0.0, 0.0]);
    assert_eq!(
        decode_outline(&empty_close),
        Err(CodecError::InvalidCommandOrder {
            index: 1,
            reason: CommandOrderError::CloseWithoutDrawingSegment,
        })
    );

    let after_close = raw_outline(&[0, 1, 4, 1], &[0.0, 0.0, 1.0, 1.0, 2.0, 2.0]);
    assert!(matches!(
        decode_outline(&after_close),
        Err(CodecError::InvalidCommandOrder { index: 3, .. })
    ));
}

#[test]
fn decoder_rejects_arity_padding_and_non_finite_coordinates() {
    let wrong_arity = raw_outline(&[0, 1], &[0.0, 0.0]);
    assert_eq!(
        decode_outline(&wrong_arity),
        Err(CodecError::CoordinateCountMismatch {
            expected: 4,
            actual: 2,
        })
    );

    let mut non_zero_padding = OPEN.to_vec();
    non_zero_padding[18] = 1;
    assert_eq!(
        decode_outline(&non_zero_padding),
        Err(CodecError::NonZeroPadding { offset: 18 })
    );

    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let non_finite = raw_outline(&[0], &[value, 0.0]);
        assert_eq!(
            decode_outline(&non_finite),
            Err(CodecError::NonFiniteCoordinate { index: 0 })
        );
    }
}

#[test]
fn encoder_rejects_illegal_command_ordering() {
    assert!(matches!(
        pack_outline(&[Command64::Line { x: 1.0, y: 2.0 }]),
        Err(CodecError::InvalidCommandOrder {
            reason: CommandOrderError::DrawingCommandWithoutContour,
            ..
        })
    ));
    assert!(matches!(
        pack_outline(&[Command64::Close]),
        Err(CodecError::InvalidCommandOrder {
            reason: CommandOrderError::CloseWithoutContour,
            ..
        })
    ));
    assert!(matches!(
        pack_outline(&[Command64::Move { x: 0.0, y: 0.0 }, Command64::Close]),
        Err(CodecError::InvalidCommandOrder {
            reason: CommandOrderError::CloseWithoutDrawingSegment,
            ..
        })
    ));
}

#[test]
fn encoder_rejects_non_finite_and_out_of_range_input() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(matches!(
            pack_outline(&[Command64::Move { x: value, y: 0.0 }]),
            Err(CodecError::NonFiniteInputCoordinate { index: 0 })
        ));
    }

    assert!(matches!(
        pack_outline(&[Command64::Move {
            x: f64::MAX,
            y: 0.0
        }]),
        Err(CodecError::CoordinateOutOfF32Range { index: 0 })
    ));
}

#[test]
fn decoder_applies_limits_before_body_iteration() {
    let mut bytes = EMPTY.to_vec();
    bytes[8..12].copy_from_slice(&((MAX_COMMAND_COUNT as u32) + 1).to_le_bytes());

    assert!(matches!(
        decode_outline(&bytes),
        Err(CodecError::LimitExceeded {
            field: "command count",
            ..
        })
    ));
}

#[test]
fn mutated_payloads_never_panic_and_any_accepted_payload_is_canonical() {
    let seed_commands = golden_vectors()
        .into_iter()
        .flat_map(|(_, _, commands)| commands)
        .collect::<Vec<_>>();
    let seed = pack_outline(&seed_commands).unwrap().into_bytes();
    let mut random = 0x7a11_4e29_u32;

    for iteration in 0..10_000 {
        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        let mut candidate = seed.clone();
        let offset = random as usize % candidate.len();
        candidate[offset] ^= (random >> 24) as u8 | 1;
        if iteration % 7 == 0 {
            candidate.truncate(random as usize % candidate.len());
        } else if iteration % 11 == 0 {
            candidate.push((random >> 16) as u8);
        }

        if let Some(canonical) = canonicalize(&candidate) {
            assert_eq!(canonical, candidate);
        }
    }
}
