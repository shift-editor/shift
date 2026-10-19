//! Spike 12: what a general glyph delete (and reorder) costs, in the engine's
//! persistent glyph list and in the store's `order_index`, on 65,535 glyphs.
//!
//! `cargo test --release --test spike12_glyph_order -- --nocapture --test-threads=1`

use std::sync::Arc;
use std::time::{Duration, Instant};

use shift_font::collection::PersistentEntityList;
use shift_font::{Glyph, GlyphId};

const GLYPHS: usize = 65_535;

fn ms(d: Duration) -> String {
    format!("{:.2} ms", d.as_secs_f64() * 1000.0)
}

fn list() -> (PersistentEntityList<Arc<Glyph>>, Vec<GlyphId>) {
    let mut list = PersistentEntityList::new();
    let mut ids = Vec::new();
    for i in 0..GLYPHS {
        let id = GlyphId::from_raw(format!("g{i}"));
        ids.push(id.clone());
        list.insert(Arc::new(Glyph::with_id(id, format!("uni{i:05X}").as_str())));
    }
    (list, ids)
}

#[test]
fn engine_glyph_list_delete_costs() {
    let (base, ids) = list();

    // One delete near the front: every later position shifts. The engine
    // applies edits to a clone, so the removal also copies shared structure.
    let mut times = Vec::new();
    for _ in 0..5 {
        let mut next = base.clone();
        let start = Instant::now();
        next.shift_remove(&ids[10]);
        times.push(start.elapsed());
    }
    eprintln!("one delete near the front (of {GLYPHS}): best {}", ms(*times.iter().min().unwrap()));

    let mut next = base.clone();
    let start = Instant::now();
    next.shift_remove(&ids[GLYPHS - 1]);
    eprintln!("one delete at the tail: {}", ms(start.elapsed()));

    // 1,000 deletes spread across the font, one at a time.
    let victims: Vec<&GlyphId> = ids.iter().step_by(GLYPHS / 1000).take(1000).collect();
    let mut next = base.clone();
    let start = Instant::now();
    for id in &victims {
        next.shift_remove(id);
    }
    eprintln!("1,000 deletes one at a time: {}", ms(start.elapsed()));

    // The batch alternative: rebuild the list once without the victims.
    let start = Instant::now();
    let doomed: std::collections::HashSet<&GlyphId> = victims.iter().copied().collect();
    let mut rebuilt = PersistentEntityList::new();
    for glyph in base.values() {
        if !doomed.contains(&glyph.id()) {
            rebuilt.insert(glyph.clone());
        }
    }
    eprintln!("1,000 deletes as one rebuild: {}", ms(start.elapsed()));
    assert_eq!(rebuilt.len(), next.len());
    assert!(rebuilt.values().map(|g| g.id()).eq(next.values().map(|g| g.id())));
}

#[test]
fn store_order_index_delete_costs() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = rusqlite::Connection::open(dir.path().join("order.sqlite")).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE glyphs (id TEXT PRIMARY KEY, name TEXT, order_index INTEGER NOT NULL DEFAULT 0);").unwrap();
    {
        let tx = conn.transaction().unwrap();
        for i in 0..GLYPHS {
            tx.execute("INSERT INTO glyphs (id, name, order_index) VALUES (?1, ?2, ?3)", rusqlite::params![format!("g{i}"), format!("uni{i:05X}"), i as i64]).unwrap();
        }
        tx.commit().unwrap();
    }

    let delete_one = |tx: &rusqlite::Transaction<'_>, id: &str| {
        let order: i64 = tx.query_row("SELECT order_index FROM glyphs WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        tx.execute("DELETE FROM glyphs WHERE id = ?1", [id]).unwrap();
        tx.execute("UPDATE glyphs SET order_index = order_index - 1 WHERE order_index > ?1", [order]).unwrap();
    };

    let tx = conn.transaction().unwrap();
    let start = Instant::now();
    delete_one(&tx, "g10");
    let one = start.elapsed();
    tx.rollback().unwrap();
    eprintln!("store: one delete near the front, renumbering the rest: {}", ms(one));

    let victims: Vec<String> = (0..GLYPHS).step_by(GLYPHS / 1000).take(1000).map(|i| format!("g{i}")).collect();
    let tx = conn.transaction().unwrap();
    let start = Instant::now();
    for id in &victims {
        delete_one(&tx, id);
    }
    let each = start.elapsed();
    tx.rollback().unwrap();
    eprintln!("store: 1,000 deletes, renumbering after each: {}", ms(each));

    let tx = conn.transaction().unwrap();
    let start = Instant::now();
    for id in &victims {
        tx.execute("DELETE FROM glyphs WHERE id = ?1", [id]).unwrap();
    }
    tx.execute(
        "WITH ranked AS (SELECT id, row_number() OVER (ORDER BY order_index) - 1 AS n FROM glyphs)
         UPDATE glyphs SET order_index = ranked.n FROM ranked WHERE glyphs.id = ranked.id AND glyphs.order_index != ranked.n",
        [],
    )
    .unwrap();
    let batch = start.elapsed();
    let start = Instant::now();
    tx.commit().unwrap();
    eprintln!("store: 1,000 deletes, one renumber: {} (+ commit {})", ms(batch), ms(start.elapsed()));
}
