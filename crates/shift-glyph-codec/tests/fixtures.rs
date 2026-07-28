use std::{collections::HashSet, fs, path::PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use shift_glyph_codec::{decode_layer, decode_outline, pack_layer, pack_outline, OutlineCommand};

#[derive(Deserialize)]
struct LayerManifest {
    format: String,
    vectors: Vec<BinaryVector>,
}

#[derive(Deserialize)]
struct BinaryVector {
    file: String,
    bytes: usize,
    sha256: String,
}

#[derive(Deserialize)]
struct OutlineManifest {
    format: String,
    vectors: Vec<OutlineVector>,
}

#[derive(Deserialize)]
struct OutlineVector {
    name: String,
    file: String,
    bytes: usize,
    sha256: String,
    commands: Vec<ManifestCommand>,
}

#[derive(Deserialize)]
struct ManifestCommand {
    kind: String,
    coordinates: Vec<f64>,
}

#[test]
fn layer_manifest_declares_every_canonical_fixture() {
    let directory = fixture_directory("layer-v1");
    let manifest: LayerManifest =
        serde_json::from_slice(&fs::read(directory.join("vectors.json")).unwrap()).unwrap();
    assert_eq!(manifest.format, "shift.glyph-layer.v1");
    assert_unique_files(manifest.vectors.iter().map(|vector| vector.file.as_str()));

    for vector in manifest.vectors {
        let bytes = fs::read(directory.join(&vector.file)).unwrap();
        assert_binary_facts(&vector, &bytes);
        let layer = decode_layer(&bytes).unwrap().unpack();
        assert_eq!(pack_layer(&layer).unwrap().as_bytes(), bytes);
    }
}

#[test]
fn outline_manifest_declares_every_canonical_fixture() {
    let directory = fixture_directory("outline-v1");
    let manifest: OutlineManifest =
        serde_json::from_slice(&fs::read(directory.join("vectors.json")).unwrap()).unwrap();
    assert_eq!(manifest.format, "shift.glyph-outline.v1");
    let vectors = manifest.vectors;
    assert_unique_files(vectors.iter().map(|vector| vector.file.as_str()));
    assert_eq!(
        vectors
            .iter()
            .map(|vector| vector.name.as_str())
            .collect::<HashSet<_>>()
            .len(),
        vectors.len()
    );

    for vector in vectors {
        let bytes = fs::read(directory.join(&vector.file)).unwrap();
        assert_binary_facts(
            &BinaryVector {
                file: vector.file,
                bytes: vector.bytes,
                sha256: vector.sha256,
            },
            &bytes,
        );
        let commands = vector
            .commands
            .iter()
            .map(manifest_command)
            .collect::<Vec<_>>();
        assert_eq!(pack_outline(&commands).unwrap().as_bytes(), bytes);
        assert_eq!(
            decode_outline(&bytes).unwrap().command_count(),
            commands.len()
        );
    }
}

fn fixture_directory(format: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/glyph-codec")
        .join(format)
}

fn assert_unique_files<'a>(files: impl Iterator<Item = &'a str>) {
    let files = files.collect::<Vec<_>>();
    assert_eq!(
        files.iter().copied().collect::<HashSet<_>>().len(),
        files.len()
    );
}

fn assert_binary_facts(vector: &BinaryVector, bytes: &[u8]) {
    assert_eq!(bytes.len(), vector.bytes, "{} byte length", vector.file);
    assert_eq!(
        hex(&Sha256::digest(bytes)),
        vector.sha256,
        "{} SHA-256",
        vector.file
    );
}

fn manifest_command(command: &ManifestCommand) -> OutlineCommand<f64> {
    match (command.kind.as_str(), command.coordinates.as_slice()) {
        ("move", [x, y]) => OutlineCommand::Move { x: *x, y: *y },
        ("line", [x, y]) => OutlineCommand::Line { x: *x, y: *y },
        ("quad", [cx, cy, x, y]) => OutlineCommand::Quad {
            cx: *cx,
            cy: *cy,
            x: *x,
            y: *y,
        },
        ("cubic", [c1x, c1y, c2x, c2y, x, y]) => OutlineCommand::Cubic {
            c1x: *c1x,
            c1y: *c1y,
            c2x: *c2x,
            c2y: *c2y,
            x: *x,
            y: *y,
        },
        ("close", []) => OutlineCommand::Close,
        _ => panic!("invalid manifest command {}", command.kind),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
