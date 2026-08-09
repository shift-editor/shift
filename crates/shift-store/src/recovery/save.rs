use rusqlite::Connection;

use crate::{CommitId, StoreError};

pub(super) fn apply_recovery_to_document(
    conn: &mut Connection,
    commit_id: &CommitId,
) -> Result<(), StoreError> {
    let tx = conn.transaction()?;
    tx.execute_batch(APPLY_RECOVERY_SQL)?;
    tx.execute(
        "UPDATE main.document_metadata SET saved_commit_id = ?1 WHERE id = 1",
        [commit_id.as_str()],
    )?;
    tx.commit()?;
    Ok(())
}

const APPLY_RECOVERY_SQL: &str = r#"
DELETE FROM main.glyph_layers
WHERE id IN (SELECT entity_id FROM recovery.recovery_tombstones WHERE entity_kind = 'layer');
DELETE FROM main.glyphs
WHERE id IN (SELECT entity_id FROM recovery.recovery_tombstones WHERE entity_kind = 'glyph');
DELETE FROM main.sources
WHERE id IN (SELECT entity_id FROM recovery.recovery_tombstones WHERE entity_kind = 'source');
DELETE FROM main.axes
WHERE id IN (SELECT entity_id FROM recovery.recovery_tombstones WHERE entity_kind = 'axis');

UPDATE main.font_info
SET family_name = r.family_name,
    style_name = r.style_name,
    copyright = r.copyright,
    trademark = r.trademark,
    description = r.description,
    note = r.note,
    sample_text = r.sample_text,
    designer = r.designer,
    designer_url = r.designer_url,
    manufacturer = r.manufacturer,
    manufacturer_url = r.manufacturer_url,
    license_description = r.license_description,
    license_info_url = r.license_info_url,
    vendor_id = r.vendor_id,
    version_major = r.version_major,
    version_minor = r.version_minor,
    units_per_em = r.units_per_em,
    default_source_id = r.default_source_id
FROM recovery.font_info r
WHERE main.font_info.id = r.id;
INSERT INTO main.font_info SELECT * FROM recovery.font_info r
WHERE NOT EXISTS (SELECT 1 FROM main.font_info m WHERE m.id = r.id);

UPDATE main.axes
SET tag = r.tag, name = r.name, min_value = r.min_value,
    default_value = r.default_value, max_value = r.max_value, role = r.role,
    discrete_values_json = r.discrete_values_json, labels_json = r.labels_json,
    hidden = r.hidden, order_index = r.order_index
FROM recovery.axes r WHERE main.axes.id = r.id;
INSERT INTO main.axes SELECT * FROM recovery.axes r
WHERE NOT EXISTS (SELECT 1 FROM main.axes m WHERE m.id = r.id);

DELETE FROM main.axis_mappings
WHERE EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'axis_mappings' AND owner_id = '');
INSERT INTO main.axis_mappings SELECT * FROM recovery.axis_mappings
WHERE EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'axis_mappings' AND owner_id = '');

UPDATE main.metric_definitions
SET kind = r.kind, name = r.name, order_index = r.order_index
FROM recovery.metric_definitions r WHERE main.metric_definitions.id = r.id;
INSERT INTO main.metric_definitions SELECT * FROM recovery.metric_definitions r
WHERE NOT EXISTS (SELECT 1 FROM main.metric_definitions m WHERE m.id = r.id);
DELETE FROM main.source_metric_values
WHERE metric_id NOT IN (SELECT id FROM recovery.metric_definitions)
  AND EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'metric_definitions' AND owner_id = '');
DELETE FROM main.metric_definitions
WHERE id NOT IN (SELECT id FROM recovery.metric_definitions)
  AND EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'metric_definitions' AND owner_id = '');

DELETE FROM main.named_instances
WHERE EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'named_instances' AND owner_id = '');
INSERT INTO main.named_instances SELECT * FROM recovery.named_instances
WHERE EXISTS (SELECT 1 FROM recovery.recovery_replacements WHERE collection = 'named_instances' AND owner_id = '');

UPDATE main.sources
SET name = r.name,
    family_name = COALESCE(r.family_name, main.sources.family_name),
    style_name = COALESCE(r.style_name, main.sources.style_name),
    filename = r.filename, color = r.color, layer_name = r.layer_name,
    italic_angle = r.italic_angle, line_gap = r.line_gap,
    underline_position = r.underline_position,
    underline_thickness = r.underline_thickness, kind = r.kind,
    order_index = r.order_index
FROM recovery.sources r WHERE main.sources.id = r.id;
INSERT INTO main.sources SELECT * FROM recovery.sources r
WHERE NOT EXISTS (SELECT 1 FROM main.sources m WHERE m.id = r.id);

DELETE FROM main.source_locations
WHERE source_id IN (SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'source_locations');
INSERT INTO main.source_locations
SELECT v.* FROM temp.source_locations v
WHERE v.source_id IN (
    SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'source_locations'
);
DELETE FROM main.source_metric_values
WHERE source_id IN (SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'source_metric_values');
INSERT INTO main.source_metric_values
SELECT v.* FROM temp.source_metric_values v
WHERE v.source_id IN (
    SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'source_metric_values'
);
DELETE FROM main.source_lib
WHERE source_id IN (SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'source_lib');
INSERT INTO main.source_lib
SELECT v.* FROM temp.source_lib v
WHERE v.source_id IN (
    SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'source_lib'
);

UPDATE main.glyphs
SET name = r.name, order_index = r.order_index
FROM recovery.glyphs r WHERE main.glyphs.id = r.id;
INSERT INTO main.glyphs SELECT * FROM recovery.glyphs r
WHERE NOT EXISTS (SELECT 1 FROM main.glyphs m WHERE m.id = r.id);
DELETE FROM main.glyph_unicodes
WHERE glyph_id IN (SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'glyph_unicodes');
INSERT INTO main.glyph_unicodes
SELECT v.* FROM temp.glyph_unicodes v
WHERE v.glyph_id IN (
    SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'glyph_unicodes'
);
DELETE FROM main.glyph_lib
WHERE glyph_id IN (SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'glyph_lib');
INSERT INTO main.glyph_lib
SELECT v.* FROM temp.glyph_lib v
WHERE v.glyph_id IN (
    SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'glyph_lib'
);

UPDATE main.glyph_layers
SET glyph_id = r.glyph_id, source_id = r.source_id, width = r.width, height = r.height
FROM recovery.glyph_layers r WHERE main.glyph_layers.id = r.id;
INSERT INTO main.glyph_layers
SELECT v.* FROM temp.glyph_layers v
WHERE EXISTS (SELECT 1 FROM recovery.glyph_layers r WHERE r.id = v.id)
  AND NOT EXISTS (SELECT 1 FROM main.glyph_layers m WHERE m.id = v.id);
INSERT OR REPLACE INTO main.glyph_layer_payloads
SELECT v.* FROM temp.glyph_layer_payloads v
WHERE EXISTS (SELECT 1 FROM recovery.glyph_layer_payloads r WHERE r.layer_id = v.layer_id);
DELETE FROM main.glyph_components
WHERE layer_id IN (SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'glyph_components');
INSERT INTO main.glyph_components
SELECT v.* FROM temp.glyph_components v
WHERE v.layer_id IN (
    SELECT owner_id FROM recovery.recovery_replacements WHERE collection = 'glyph_components'
);
"#;
