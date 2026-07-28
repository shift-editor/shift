pub(crate) const FRAME_PREFIX_LEN: usize = 8;
const MAGIC: &[u8; 4] = b"SHFT";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FrameError {
    HeaderTruncated { actual: usize },
    WrongMagic,
    UnsupportedPayloadKind(u8),
    UnsupportedVersion(u8),
    UnknownFlags(u16),
}

pub(crate) fn validate_frame(
    bytes: &[u8],
    header_len: usize,
    expected_kind: u8,
    expected_version: u8,
) -> Result<(), FrameError> {
    if bytes.len() < header_len {
        return Err(FrameError::HeaderTruncated {
            actual: bytes.len(),
        });
    }
    if &bytes[..4] != MAGIC {
        return Err(FrameError::WrongMagic);
    }
    if bytes[4] != expected_kind {
        return Err(FrameError::UnsupportedPayloadKind(bytes[4]));
    }
    if bytes[5] != expected_version {
        return Err(FrameError::UnsupportedVersion(bytes[5]));
    }

    let flags = u16::from_le_bytes([bytes[6], bytes[7]]);
    if flags != 0 {
        return Err(FrameError::UnknownFlags(flags));
    }
    Ok(())
}

pub(crate) fn write_frame(bytes: &mut [u8], kind: u8, version: u8) {
    assert!(bytes.len() >= FRAME_PREFIX_LEN);
    bytes[..4].copy_from_slice(MAGIC);
    bytes[4] = kind;
    bytes[5] = version;
    bytes[6..8].copy_from_slice(&0_u16.to_le_bytes());
}
