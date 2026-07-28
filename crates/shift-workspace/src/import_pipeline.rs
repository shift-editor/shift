use std::time::{Duration, Instant};

use shift_backends::{FontImport, ImportBatchLimit};
use shift_store::LayerStreamWriter;

use crate::WorkspaceError;

#[derive(Clone, Copy, Debug)]
pub struct ImportBatchProgress {
    pub glyph_count: usize,
    pub layer_count: usize,
    pub parse_elapsed: Duration,
    pub write_elapsed: Duration,
}

/// Runs the bounded parser/SQLite pipeline with one writer and a two-batch
/// channel. The observer runs after each batch is durably staged in the open
/// transaction; it must remain lightweight so it does not throttle the writer.
pub fn stream_into(
    mut import: FontImport,
    writer: &mut LayerStreamWriter<'_>,
    batch_limit: ImportBatchLimit,
    mut observe: impl FnMut(ImportBatchProgress),
) -> Result<(), WorkspaceError> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(2);
    std::thread::scope(|scope| -> Result<(), WorkspaceError> {
        scope.spawn(move || {
            loop {
                let started = Instant::now();
                match import.next_batch(batch_limit) {
                    Ok(glyphs) if glyphs.is_empty() => break,
                    Ok(glyphs) => {
                        if sender.send(Ok((glyphs, started.elapsed()))).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        break;
                    }
                }
            }
        });

        for result in receiver {
            let (glyphs, parse_elapsed) = result?;
            let glyph_count = glyphs.len();
            let layer_count = glyphs.iter().map(|glyph| glyph.layers().len()).sum();
            let started = Instant::now();
            writer.write_glyph_batch(&glyphs)?;
            observe(ImportBatchProgress {
                glyph_count,
                layer_count,
                parse_elapsed,
                write_elapsed: started.elapsed(),
            });
        }
        Ok(())
    })
}
