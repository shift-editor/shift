use std::time::{Duration, Instant};

use shift_backends::{FontImport, ImportBatchLimit};
use shift_font::Glyph;
use shift_store::{LayerStreamWriter, PackedGlyphBatch, pack_glyph_batch};

use crate::WorkspaceError;

#[derive(Clone, Copy, Debug)]
pub struct ImportBatchProgress {
    pub glyph_count: usize,
    pub layer_count: usize,
    pub parse_elapsed: Duration,
    pub pack_elapsed: Duration,
    pub compression_elapsed: Duration,
    pub sqlite_elapsed: Duration,
}

struct ParsedImportBatch {
    glyphs: Vec<Glyph>,
    glyph_count: usize,
    layer_count: usize,
    parse_elapsed: Duration,
}

struct PackedImportBatch {
    glyphs: PackedGlyphBatch,
    glyph_count: usize,
    layer_count: usize,
    parse_elapsed: Duration,
}

/// Runs a bounded parser/packer/SQLite pipeline with one writer. Rendezvous
/// channels keep one batch active per stage without retaining queued batches.
/// The observer runs after each batch is staged in the open transaction; it
/// must remain lightweight so it does not throttle the writer.
pub fn stream_into(
    mut import: FontImport,
    writer: &mut LayerStreamWriter<'_>,
    batch_limit: ImportBatchLimit,
    mut observe: impl FnMut(ImportBatchProgress),
) -> Result<(), WorkspaceError> {
    let (parsed_sender, parsed_receiver) = std::sync::mpsc::sync_channel(0);
    let (packed_sender, packed_receiver) = std::sync::mpsc::sync_channel(0);
    std::thread::scope(|scope| -> Result<(), WorkspaceError> {
        scope.spawn(move || {
            loop {
                let started = Instant::now();
                match import.next_batch(batch_limit) {
                    Ok(glyphs) if glyphs.is_empty() => break,
                    Ok(glyphs) => {
                        let batch = ParsedImportBatch {
                            glyph_count: glyphs.len(),
                            layer_count: glyphs.iter().map(|glyph| glyph.layers().len()).sum(),
                            glyphs,
                            parse_elapsed: started.elapsed(),
                        };
                        if parsed_sender.send(Ok(batch)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = parsed_sender.send(Err(error));
                        break;
                    }
                }
            }
        });

        scope.spawn(move || {
            for result in parsed_receiver {
                let batch = match result {
                    Ok(batch) => batch,
                    Err(error) => {
                        let _ = packed_sender.send(Err(WorkspaceError::from(error)));
                        break;
                    }
                };
                let glyphs = match pack_glyph_batch(batch.glyphs) {
                    Ok(glyphs) => glyphs,
                    Err(error) => {
                        let _ = packed_sender.send(Err(WorkspaceError::from(error)));
                        break;
                    }
                };
                let batch = PackedImportBatch {
                    glyphs,
                    glyph_count: batch.glyph_count,
                    layer_count: batch.layer_count,
                    parse_elapsed: batch.parse_elapsed,
                };
                if packed_sender.send(Ok(batch)).is_err() {
                    break;
                }
            }
        });

        for result in packed_receiver {
            let batch = result?;
            let pack_elapsed = batch.glyphs.pack_elapsed();
            let compression_elapsed = batch.glyphs.compression_elapsed();
            let sqlite_elapsed = writer.write_packed_glyph_batch(batch.glyphs)?;
            observe(ImportBatchProgress {
                glyph_count: batch.glyph_count,
                layer_count: batch.layer_count,
                parse_elapsed: batch.parse_elapsed,
                pack_elapsed,
                compression_elapsed,
                sqlite_elapsed,
            });
        }
        Ok(())
    })
}
